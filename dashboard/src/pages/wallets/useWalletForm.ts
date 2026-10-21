import { useState, useCallback, useRef, useEffect } from 'react';
import { URDecoder, UREncoder } from '@ngraveio/bc-ur';
import { Html5Qrcode } from 'html5-qrcode';
import {
  detectChainFromAddress,
  validateWalletAddress,
  getActiveChains,
  getChainByShortName,
  getChainConfig,
  describeFailure,
} from '@ledova/shared';
import type { CreateWallet, DerivedAddress, HardwareWalletImport } from '@ledova/shared';
import { hasProblems, type Problems } from '@hooks/useErrorSummary';

type FormStep = 'input' | 'selectAddresses';

interface UseWalletFormProps {
  onSubmit: (data: CreateWallet) => void;
  onBatchSubmit: (addresses: DerivedAddress[], importData: HardwareWalletImport) => void;
  preselectedChain?: 'BTC' | 'ETH' | null;
}

export function useWalletForm({ onSubmit, onBatchSubmit, preselectedChain }: UseWalletFormProps) {
  const [step, setStep] = useState<FormStep>('input');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [selectedChain, setSelectedChain] = useState<string | null>(() => {
    if (preselectedChain) {
      const chain = getChainByShortName(preselectedChain);
      return chain?.code || null;
    }
    const activeChains = getActiveChains();
    return activeChains[0]?.code || null;
  });
  const [showScanner, setShowScanner] = useState(false);
  const [scannedURString, setScannedURString] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ received: number; total: number } | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const urDecoderRef = useRef<URDecoder | null>(null);
  const processedPartsRef = useRef<Set<string>>(new Set());

  const reset = useCallback(() => {
    setStep('input');
    setName('');
    setAddress('');
    setShowScanner(false);
    setScannedURString(null);
    setScanProgress(null);
    setScannerError(null);
    urDecoderRef.current = null;
    processedPartsRef.current.clear();
    const activeChains = getActiveChains();
    setSelectedChain(activeChains[0]?.code || null);
  }, []);

  const chain = selectedChain ? getChainConfig(selectedChain) : undefined;
  const problems: Problems<'address' | 'network'> = {
    address: !address.trim()
      ? 'Enter the wallet address.'
      : !!chain && !validateWalletAddress(address.trim(), chain.shortName) && `Enter a valid ${chain.name} address.`,
    network: !chain?.isActive && 'Choose the wallet network.',
  };

  const handleAddressChange = useCallback(
    (text: string) => {
      setAddress(text);

      if (text.length > 10) {
        const detectedShortName = detectChainFromAddress(text);
        if (detectedShortName) {
          const chain = getChainByShortName(detectedShortName);
          if (chain && chain.code !== selectedChain && !(detectedShortName === 'ETH' && selectedChain === 'base')) {
            setSelectedChain(chain.code);
          }
        }
      }
    },
    [selectedChain],
  );

  const stopCamera = useCallback(() => {
    if (html5QrCodeRef.current) {
      html5QrCodeRef.current.stop().catch(() => {});
      html5QrCodeRef.current = null;
    }
    urDecoderRef.current = null;
    processedPartsRef.current.clear();
  }, []);

  const stopScanner = useCallback(() => {
    stopCamera();
    setScanProgress(null);
    setScannerError(null);
  }, [stopCamera]);

  const handleQRScanResult = useCallback(
    (data: string) => {
      const dataLower = data.toLowerCase();
      const isBCUR = dataLower.startsWith('ur:');

      if (isBCUR) {
        if (!urDecoderRef.current) {
          urDecoderRef.current = new URDecoder();
        }

        if (processedPartsRef.current.has(dataLower)) {
          return;
        }

        processedPartsRef.current.add(dataLower);

        try {
          urDecoderRef.current.receivePart(dataLower);

          const estimatedPercentComplete = urDecoderRef.current.estimatedPercentComplete();
          const receivedParts = processedPartsRef.current.size;
          setScanProgress({
            received: receivedParts,
            total: estimatedPercentComplete > 0 ? Math.ceil(receivedParts / estimatedPercentComplete) : receivedParts,
          });

          if (urDecoderRef.current.isComplete()) {
            const ur = urDecoderRef.current.resultUR();

            const encoder = new UREncoder(ur, 100000);
            const completeURString = encoder.nextPart();

            stopScanner();
            setScannedURString(completeURString);
            setShowScanner(false);
            setStep('selectAddresses');
          }
        } catch {}
        return;
      }

      stopScanner();
      setAddress(data);
      setShowScanner(false);

      const detectedShortName = detectChainFromAddress(data);
      if (detectedShortName) {
        const chain = getChainByShortName(detectedShortName);
        if (chain && !(detectedShortName === 'ETH' && selectedChain === 'base')) {
          setSelectedChain(chain.code);
        }
      }
    },
    [selectedChain],
  );

  const startScanner = useCallback(() => {
    if (html5QrCodeRef.current) return;

    const html5QrCode = new Html5Qrcode('wallet-qr-scanner');
    html5QrCodeRef.current = html5QrCode;

    const qrConfig = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
    };

    Html5Qrcode.getCameras()
      .then((cameras) => {
        if (cameras && cameras.length > 0) {
          const cameraId = cameras[0].id;
          return html5QrCode.start(cameraId, qrConfig, handleQRScanResult, () => {});
        } else {
          throw new Error('No cameras found');
        }
      })
      .catch((err) => {
        console.error(`Failed to start QR scanner: ${describeFailure(err)}`);
        setScannerError('Unable to access camera. Please check permissions.');
      });
  }, [handleQRScanResult]);

  useEffect(() => {
    if (showScanner) {
      const timer = setTimeout(startScanner, 100);
      return () => clearTimeout(timer);
    } else {
      stopCamera();
    }
  }, [showScanner, startScanner, stopCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const handleAddressSelection = useCallback(
    (addresses: DerivedAddress[], importData: HardwareWalletImport) => {
      onBatchSubmit(addresses, importData);
    },
    [onBatchSubmit],
  );

  const handleBackToInput = useCallback(() => {
    setStep('input');
    setScannedURString(null);
    setScanProgress(null);
  }, []);

  const handleSubmit = () => {
    if (hasProblems(problems) || !chain?.isActive) return;
    onSubmit({
      name: name.trim() || undefined,
      address: address.trim(),
      chain: chain.code,
    });
  };

  const toggleScanner = useCallback(() => {
    setShowScanner((prev) => !prev);
    setScannerError(null);
    setScanProgress(null);
    urDecoderRef.current = null;
    processedPartsRef.current.clear();
  }, []);

  return {
    step,
    name,
    address,
    selectedChain,
    problems,
    showScanner,
    scannedURString,
    scanProgress,
    scannerError,
    isSelectingAddresses: step === 'selectAddresses' && !!scannedURString,

    setName,
    setSelectedChain,

    reset,
    handleAddressChange,
    handleAddressSelection,
    handleBackToInput,
    handleSubmit,
    toggleScanner,
    stopScanner,
  };
}
