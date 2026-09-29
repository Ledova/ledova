import React, { useEffect } from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { cleanup, render } from '@testing-library/react-native';
import { CustomModal } from './CustomModal';

const mockLifecycle: string[] = [];
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const { useEffect } = jest.requireActual('react');
  function MockModal({ children }: { children: React.ReactNode }) {
    useEffect(() => {
      mockLifecycle.push('modal mounted');
      return () => {
        mockLifecycle.push('modal unmounted');
      };
    }, []);
    return children;
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

function dialog(contentKey: string, onConfirm?: () => void, visible = true) {
  return (
    <CustomModal visible={visible} showFooter contentKey={contentKey} onClose={() => {}} onConfirm={onConfirm}>
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

it('moves screen reader focus to the new content only when content already shown is replaced', async () => {
  const focus = jest.mocked(AccessibilityInfo.sendAccessibilityEvent);
  const view = await render(dialog('status'));
  const shownContent = () => view.root!.props.onResponderGrant;
  await view.rerender(dialog('status', () => {}));
  expect(focus).not.toHaveBeenCalled();

  await view.rerender(dialog('confirmable', () => {}));
  expect(focus).toHaveBeenCalledTimes(1);
  const [target, event] = focus.mock.calls[0]!;
  expect(event).toBe('focus');
  expect((target as unknown as { props: { onResponderGrant: unknown } }).props.onResponderGrant).toBe(shownContent());

  await view.rerender(dialog('status', undefined, false));
  expect(focus).toHaveBeenCalledTimes(1);
  await view.rerender(dialog('confirmable', () => {}));
  expect(focus).toHaveBeenCalledTimes(1);
});
