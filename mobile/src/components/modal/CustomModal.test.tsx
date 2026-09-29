import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { cleanup, render } from '@testing-library/react-native';
import { CustomModal } from './CustomModal';

const mockLifecycle: string[] = [];
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const { useEffect } = jest.requireActual('react');
  function MockModal({ visible, children }: { visible: boolean; children: React.ReactNode }) {
    useEffect(() => {
      mockLifecycle.push('modal mounted');
      return () => {
        mockLifecycle.push('modal unmounted');
      };
    }, []);
    return visible ? children : null;
  }
  return { __esModule: true, default: MockModal };
});

function Content() {
  useEffect(() => {
    mockLifecycle.push('content mounted');
    return () => {
      mockLifecycle.push('content unmounted');
    };
  }, []);
  return <Text>Dialog content</Text>;
}

function dialog(contentKey: string, onConfirm?: () => void) {
  return (
    <CustomModal visible showFooter contentKey={contentKey} onClose={() => {}} onConfirm={onConfirm}>
      <Content />
    </CustomModal>
  );
}

afterEach(async () => {
  await cleanup();
  mockLifecycle.length = 0;
});

it('starts fresh dialog content without replacing its modal when the content key changes', async () => {
  const view = await render(dialog('status'));
  await view.rerender(dialog('status', () => {}));
  expect(mockLifecycle).toEqual(['content mounted', 'modal mounted']);

  await view.rerender(dialog('confirmable', () => {}));
  expect(mockLifecycle).toEqual(['content mounted', 'modal mounted', 'content unmounted', 'content mounted']);
  expect(view.getByText('Dialog content')).toBeTruthy();
  expect(view.getByText('Confirm')).toBeTruthy();
});
