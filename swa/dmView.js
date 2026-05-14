import { formatTime, getDisplayName, renderIdentityBadge } from './feedView.js';

export function renderDmConvItem(pubkey, latestEvent, slice, onClick) {
  const { profiles, verifiedIdentities, dmDecrypted, currentDmContact } = slice;
  const profile = profiles.get(pubkey);
  const displayName = getDisplayName(profile, pubkey.slice(0, 12) + '…');
  const preview = dmDecrypted.get(latestEvent.id) ?? '…';

  const item = document.createElement('div');
  item.className = 'dm-conv-item' + (pubkey === currentDmContact ? ' active' : '');

  const nameRow = document.createElement('div');
  nameRow.className = 'dm-conv-name-row';

  const nameEl = document.createElement('span');
  nameEl.className = 'dm-conv-name';
  nameEl.textContent = displayName;
  nameRow.appendChild(nameEl);

  const idBadge = renderIdentityBadge(pubkey, profile, verifiedIdentities);
  if (idBadge) nameRow.appendChild(idBadge);

  const previewEl = document.createElement('span');
  previewEl.className = 'dm-conv-preview';
  previewEl.textContent = preview.length > 50 ? preview.slice(0, 50) + '…' : preview;

  item.append(nameRow, previewEl);
  item.addEventListener('click', () => onClick(pubkey));
  return item;
}

export function renderDmThreadTitle(pubkey, slice) {
  const { profiles, verifiedIdentities } = slice;
  const profile = profiles.get(pubkey);
  const displayName = getDisplayName(profile, pubkey.slice(0, 12) + '…');

  const fragment = document.createDocumentFragment();
  fragment.appendChild(document.createTextNode(`Conversation with ${displayName}`));
  const idBadge = renderIdentityBadge(pubkey, profile, verifiedIdentities);
  if (idBadge) fragment.appendChild(idBadge);
  return fragment;
}

export function renderDmMessage(event, slice) {
  const { myPubkey, dmDecrypted } = slice;
  const isOutgoing = event.pubkey === myPubkey;
  const decrypted = dmDecrypted.get(event.id);

  const wrapper = document.createElement('div');
  wrapper.dataset.dmId = event.id;
  wrapper.className = 'dm-message-wrapper ' + (isOutgoing ? 'outgoing' : 'incoming');
  if (decrypted === undefined) wrapper.classList.add('dm-pending');

  const bubble = document.createElement('div');
  bubble.className = 'dm-bubble';
  bubble.textContent = decrypted !== undefined ? decrypted : '…';

  const timeEl = document.createElement('div');
  timeEl.className = 'dm-message-time';
  timeEl.textContent = formatTime(event.created_at);

  wrapper.append(bubble, timeEl);
  return wrapper;
}
