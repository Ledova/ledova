import { useState, useCallback, useRef } from 'react';
import { URDecoder, UREncoder } from '@ngraveio/bc-ur';
import {
  detectChainFromAddress,
  validateWalletAddress,
  getActiveChains,
  getChainByShortName,
  getChainConfig,
} from '@ledova/shared';
import type { CreateWallet, DerivedAddress, HardwareWalletImport } from '@ledova/shared';
import { useQRScanner } from '@components/qr';
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

  const urDecoderRef = useRef<URDecoder | null>(null);
  const processedPartsRef = useRef<Set<string>>(new Set());

  const clearScan = useCallback(() => {
    setScanProgress(null);
    urDecoderRef.current = null;
    processedPartsRef.current.clear();
  }, []);

  const reset = useCallback(() => {
    setStep('input');
    setName('');
    setAddress('');
    setShowScanner(false);
    setScannedURString(null);
    clearScan();
    const activeChains = getActiveChains();
    setSelectedChain(activeChains[0]?.code || null);
  }, [clearScan]);

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

            clearScan();
            setScannedURString(completeURString);
            setShowScanner(false);
            setStep('selectAddresses');
          }
        } catch {}
        return;
      }

      clearScan();
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
    [selectedChain, clearScan],
  );

  const { error: scannerError } = useQRScanner({
    scannerId: 'wallet-qr-scanner',
    onScanSuccess: handleQRScanResult,
    enabled: showScanner,
    continuous: true,
  });

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
    clearScan();
  }, [clearScan]);

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
  };
}
