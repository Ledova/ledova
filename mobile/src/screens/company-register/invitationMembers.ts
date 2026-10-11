import { isUuid, type RegisterAward, type TokenHoldersResponse } from '@ledova/shared';

export interface InvitationMember {
  uuid: string;
  name: string;
  classes: string[];
  sources: string[];
}

export function invitationMembers(registers: TokenHoldersResponse[], awards: RegisterAward[], company: string) {
  const classes = new Map(registers.map(({ token }) => [token.uuid, token.symbol || token.name]));
  const members = new Map<string, InvitationMember>();
  const add = (uuid: string, name: string | null, token: string, source: string) => {
    if (!isUuid(uuid) || !classes.has(token)) throw new Error('The recipient does not match this company register.');
    const existing = members.get(uuid);
    if (existing) {
      if (!existing.classes.includes(classes.get(token)!)) existing.classes.push(classes.get(token)!);
      if (!existing.sources.includes(source)) existing.sources.push(source);
    } else {
      members.set(uuid, {
        uuid,
        name: name?.trim() || 'Unnamed member',
        classes: [classes.get(token)!],
        sources: [source],
      });
    }
  };
  for (const register of registers) {
    for (const holder of register.holders) add(holder.member, holder.name, register.token.uuid, 'Current member');
    if (!register.formerMembersStale)
      for (const former of register.formerMembers ?? [])
        if (former.member) add(former.member, former.name, register.token.uuid, 'Former member');
  }
  for (const award of awards) {
    if (award.company !== company) throw new Error('The award recipients belong to another company.');
    add(award.member, award.name, award.token, 'Award recipient');
  }
  return [...members.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.uuid.localeCompare(right.uuid),
  );
}
