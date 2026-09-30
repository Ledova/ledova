import { Text } from 'react-native';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { Action } from '../Ledger';
import { Panel } from './Panel';

afterEach(async () => {
  await cleanup();
});

it('holds a flow in the card with its title and one right-aligned action row, no grey band', async () => {
  const back = jest.fn();
  const view = await render(
    <Panel
      title="Send"
      actions={
        <>
          <Action label="Back" onPress={back} />
          <Action label="Continue" primary onPress={jest.fn()} />
        </>
      }
    >
      <Text>Destination Address</Text>
    </Panel>,
  );
  const title = view.getByRole('header', { name: 'Send' });
  const card = title.parent!;
  expect(card).toHaveStyle({ borderWidth: 1, borderRadius: 12, padding: 16 });
  const row = view.getByRole('button', { name: 'Back' }).parent!;
  expect(row.children).toEqual([
    view.getByRole('button', { name: 'Back' }),
    view.getByRole('button', { name: 'Continue' }),
  ]);
  expect(row).toHaveStyle({ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end' });
  expect(row).not.toHaveStyle({ borderTopWidth: 1 });
  expect(card.children.at(-1)).toBe(row);
  await fireEvent.press(view.getByRole('button', { name: 'Back' }));
  expect(back).toHaveBeenCalledTimes(1);
});

it('ends on its content when a step has no actions', async () => {
  const view = await render(
    <Panel title="Recovery Phrase">
      <Text>Authenticating...</Text>
    </Panel>,
  );
  const card = view.getByRole('header', { name: 'Recovery Phrase' }).parent!;
  expect(card.children).toHaveLength(2);
  expect(view.queryByRole('button')).toBeNull();
});

it('shows a notice between its content and its actions, where scrolling the content cannot hide it', async () => {
  const view = await render(
    <Panel title="Send" notice={<Text>Refused</Text>} actions={<Action label="Continue" primary onPress={jest.fn()} />}>
      <Text>Destination Address</Text>
    </Panel>,
  );
  const title = view.getByRole('header', { name: 'Send' });
  const body = view.getByText('Destination Address').parent!;
  const row = view.getByRole('button', { name: 'Continue' }).parent!;
  expect(title.parent!.children).toEqual([title, body, view.getByText('Refused'), row]);
});
