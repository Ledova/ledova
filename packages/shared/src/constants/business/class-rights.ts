import type { ClassRightsAttributes, TokenType } from '../../types';

export const CLASS_RIGHTS_EXAMPLES: Partial<Record<TokenType, { label: string; attributes: ClassRightsAttributes }>> = {
  ordinary: {
    label: 'Ordinary example',
    attributes: {
      voting: { type: 'general', votesPerShare: '1' },
      dividends: { type: 'participating' },
      capital: { type: 'residual' },
      transfers: { type: 'restricted' },
      conversion: { type: 'none' },
      redemption: { type: 'not_redeemable' },
    },
  },
  preference: {
    label: 'Preference example',
    attributes: {
      dividends: { type: 'preferential' },
      capital: { type: 'preferential' },
      transfers: { type: 'restricted' },
      redemption: { type: 'not_redeemable' },
    },
  },
  redeemable: {
    label: 'Redeemable preference example',
    attributes: {
      dividends: { type: 'preferential' },
      capital: { type: 'preferential' },
      transfers: { type: 'restricted' },
      redemption: { type: 'redeemable' },
    },
  },
};
