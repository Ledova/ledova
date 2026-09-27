import type { ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CustomModal } from '../../components/modal/CustomModal';

export function CompanyModal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <CustomModal visible onClose={onClose} maxHeight={height - insets.top - insets.bottom - 48}>
      {children}
    </CustomModal>
  );
}
