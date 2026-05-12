// Pure render functions for feed, replies, and follow items.
// Functions receive data slices and return DOM nodes — they never read from store directly.

export function formatTime(unixSec) {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(unixSec * 1000).toLocaleDateString();
}

export function pubkeyColor(pubkey) {
  const colors = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#6366f1'];
  return colors[parseInt(pubkey.slice(0, 2), 16) % colors.length];
}

export function getDisplayName(profile, fallback) {
  return profile?.name || profile?.display_name || fallback;
}

export function isOwnEvent(event, pubkeyHex) {
  return pubkeyHex != null && event.pubkey === pubkeyHex;
}

export function getReplyLabel(event, { events, profiles }) {
  const eTags = event.tags.filter(t => t[0] === 'e');
  const aTags = event.tags.filter(t => t[0] === 'a');

  if (eTags.length > 0) {
    const refId = eTags[eTags.length - 1][1];
    const refEvent = events.find(e => e.id === refId);
    const refProfile = refEvent ? profiles.get(refEvent.pubkey) : null;
    return refProfile?.name || refProfile?.display_name
      || (refEvent ? refEvent.pubkey.slice(0, 12) + '…' : refId.slice(0, 12) + '…');
  }

  if (aTags.length > 0) {
    const parts = (aTags[aTags.length - 1][1] || '').split(':');
    const refPubkey = parts[1] || '';
    const refProfile = refPubkey ? profiles.get(refPubkey) : null;
    return refProfile?.name || refProfile?.display_name
      || (refPubkey ? refPubkey.slice(0, 12) + '…' : aTags[aTags.length - 1][1].slice(0, 16) + '…');
  }

  return null;
}

export function createVerifiedBadge(identifier) {
  const badge = document.createElement('span');
  badge.className = 'verified-badge';
  badge.textContent = '✓ ' + identifier;
  badge.title = `Verified identity: ${identifier}`;
  return badge;
}

export function createOtsBadge() {
  const badge = document.createElement('a');
  badge.className = 'ots-badge';
  badge.textContent = '⏱ OTS';
  badge.title = 'OpenTimestamps attestation';
  badge.href = 'https://ots.tools/';
  badge.target = '_blank';
  badge.rel = 'noopener noreferrer';
  return badge;
}

function renderMentionContent(content, tags, profiles) {
  const fragment = document.createDocumentFragment();
  for (const part of content.split(/(#\[\d+\])/)) {
    const match = part.match(/^#\[(\d+)\]$/);
    if (match) {
      const tag = tags[parseInt(match[1], 10)];
      if (tag?.[0] === 'p') {
        const name = getDisplayName(profiles?.get(tag[1]), tag[1].slice(0, 12) + '…');
        const span = document.createElement('span');
        span.className = 'mention';
        span.textContent = '@' + name;
        span.title = tag[1];
        fragment.appendChild(span);
        continue;
      }
      if (tag?.[0] === 'e') {
        const span = document.createElement('span');
        span.className = 'mention mention--event';
        span.textContent = '#' + tag[1].slice(0, 8) + '…';
        span.title = tag[1];
        fragment.appendChild(span);
        continue;
      }
    }
    fragment.appendChild(document.createTextNode(part));
  }
  return fragment;
}

export function createAvatar(profile, displayName, pubkey) {
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  if (profile?.picture) {
    const img = document.createElement('img');
    img.src = profile.picture;
    img.alt = displayName;
    img.onerror = () => { img.remove(); avatar.textContent = (displayName[0] || '?').toUpperCase(); };
    avatar.appendChild(img);
  } else {
    avatar.textContent = (displayName[0] || '?').toUpperCase();
    avatar.style.background = pubkeyColor(pubkey);
  }
  return avatar;
}

/**
 * Renders a feed event card.
 * @param {object} event - The Nostr event.
 * @param {object} slice - { signer, profiles, verifiedIdentities, attestations, followedPubkeys, events }
 * @param {object} callbacks - { onFollow, onReply, onShowReplies, requireKeysAndRelay }
 */
export function renderEvent(event, slice, callbacks) {
  const { signer, profiles, verifiedIdentities, attestations, followedPubkeys, events } = slice;
  const { onFollow, onReply, onShowReplies, requireKeysAndRelay } = callbacks;

  const card = document.createElement('div');
  card.className = 'event-card';
  card.dataset.eventId = event.id;

  const meta = document.createElement('div');
  meta.className = 'event-meta';

  const profile = profiles.get(event.pubkey);
  const displayName = getDisplayName(profile, event.pubkey.slice(0, 12) + '…');

  const avatar = createAvatar(profile, displayName, event.pubkey);

  const authorEl = document.createElement('span');
  authorEl.className = 'event-pubkey';
  authorEl.textContent = displayName;
  authorEl.title = event.pubkey;

  const time = document.createElement('span');
  time.className = 'event-time';
  time.textContent = formatTime(event.created_at);

  const metaLeft = document.createElement('div');
  metaLeft.className = 'event-meta-left';
  metaLeft.append(avatar, authorEl, time);
  if (verifiedIdentities.has(event.pubkey)) metaLeft.appendChild(createVerifiedBadge(verifiedIdentities.get(event.pubkey)));
  if (attestations.has(event.id)) metaLeft.appendChild(createOtsBadge());
  meta.appendChild(metaLeft);

  if (!isOwnEvent(event, signer?.pubkeyHex)) {
    const alreadyFollowing = followedPubkeys.has(event.pubkey);
    const followEventBtn = document.createElement('button');
    followEventBtn.className = 'btn-follow-feed';
    followEventBtn.textContent = alreadyFollowing ? 'Following' : 'Follow';
    followEventBtn.disabled = alreadyFollowing;
    followEventBtn.addEventListener('click', () => onFollow(event.pubkey));
    meta.appendChild(followEventBtn);
  }

  const refLabel = getReplyLabel(event, { events, profiles });
  if (refLabel !== null) {
    const replyIndicator = document.createElement('div');
    replyIndicator.className = 'reply-indicator';
    replyIndicator.textContent = `↩ ${refLabel}`;
    card.append(meta, replyIndicator);
  } else {
    card.appendChild(meta);
  }

  const content = document.createElement('div');
  content.className = 'event-content';
  content.appendChild(renderMentionContent(event.content, event.tags, profiles));

  const actions = document.createElement('div');
  actions.className = 'event-actions';

  const replyBtn = document.createElement('button');
  replyBtn.className = 'btn-reply';
  replyBtn.textContent = 'Reply';

  const showRepliesBtn = document.createElement('button');
  showRepliesBtn.className = 'btn-reply';
  showRepliesBtn.textContent = 'Show replies';

  actions.append(replyBtn, showRepliesBtn);
  card.append(content, actions);

  const replyForm = createReplyForm(event, displayName, { requireKeysAndRelay, onReply });
  card.appendChild(replyForm);

  const repliesContainer = document.createElement('div');
  repliesContainer.className = 'replies-container';
  repliesContainer.hidden = true;
  card.appendChild(repliesContainer);

  replyBtn.addEventListener('click', () => {
    replyForm.hidden = !replyForm.hidden;
    if (!replyForm.hidden) replyForm.querySelector('textarea').focus();
  });

  showRepliesBtn.addEventListener('click', () => {
    onShowReplies(event, repliesContainer, showRepliesBtn);
  });

  return card;
}

function createReplyForm(parentEvent, displayName, { requireKeysAndRelay, onReply }) {
  const form = document.createElement('div');
  form.className = 'reply-form';
  form.hidden = true;

  const name = displayName;

  const label = document.createElement('div');
  label.className = 'reply-form-label';
  label.textContent = `Replying to ${name}`;

  const textarea = document.createElement('textarea');
  textarea.rows = 3;
  textarea.placeholder = 'Write your reply…';

  const formActions = document.createElement('div');
  formActions.className = 'reply-form-actions';

  const submitBtn = document.createElement('button');
  submitBtn.className = 'primary';
  submitBtn.textContent = 'Reply';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';

  const resultMsg = document.createElement('span');
  resultMsg.className = 'result-msg';

  formActions.append(submitBtn, cancelBtn, resultMsg);
  form.append(label, textarea, formActions);

  cancelBtn.addEventListener('click', () => {
    form.hidden = true;
    textarea.value = '';
    resultMsg.textContent = '';
  });

  submitBtn.addEventListener('click', async () => {
    if (!requireKeysAndRelay((msg) => {
      resultMsg.textContent = msg;
      resultMsg.className = 'result-msg err';
    })) return;
    const content = textarea.value.trim();
    if (!content) return;

    submitBtn.disabled = true;
    resultMsg.textContent = 'Posting…';
    resultMsg.className = 'result-msg';

    try {
      await onReply(parentEvent, content);
      textarea.value = '';
      form.hidden = true;
      resultMsg.textContent = '';
    } catch (err) {
      resultMsg.textContent = err.message;
      resultMsg.className = 'result-msg err';
    } finally {
      submitBtn.disabled = false;
    }
  });

  return form;
}

/**
 * Renders a reply card (compact, no actions).
 * @param {object} event - The Nostr event.
 * @param {object} slice - { profiles, verifiedIdentities }
 */
export function renderReply(event, slice) {
  const { profiles, verifiedIdentities } = slice;
  const card = document.createElement('div');
  card.className = 'reply-card';

  const meta = document.createElement('div');
  meta.className = 'event-meta';

  const profile = profiles.get(event.pubkey);
  const displayName = getDisplayName(profile, event.pubkey.slice(0, 12) + '…');

  const avatar = createAvatar(profile, displayName, event.pubkey);

  const authorEl = document.createElement('span');
  authorEl.className = 'event-pubkey';
  authorEl.textContent = displayName;
  authorEl.title = event.pubkey;

  const time = document.createElement('span');
  time.className = 'event-time';
  time.textContent = formatTime(event.created_at);

  meta.append(avatar, authorEl, time);
  if (verifiedIdentities.has(event.pubkey)) meta.appendChild(createVerifiedBadge(verifiedIdentities.get(event.pubkey)));

  const content = document.createElement('div');
  content.className = 'event-content';
  content.appendChild(renderMentionContent(event.content, event.tags, profiles));

  card.append(meta, content);
  return card;
}

/**
 * Renders a follow list item.
 * @param {object} f - Follow entry { pubkey, relay, petname }
 * @param {object} slice - { profiles, verifiedIdentities }
 * @param {object} callbacks - { onUnfollow, onPetnameChange, onRelayChange, isValidRelayUrl, bindSaveOnBlurOrEnter }
 */
export function renderFollowItem(f, slice, callbacks) {
  const { profiles, verifiedIdentities } = slice;
  const { onUnfollow, onPetnameChange, onRelayChange, isValidRelayUrl, bindSaveOnBlurOrEnter } = callbacks;

  const item = document.createElement('div');
  item.className = 'follow-item';

  const profile = profiles.get(f.pubkey);
  const displayName = getDisplayName(profile, f.petname || (f.pubkey.slice(0, 12) + '…'));

  const avatar = createAvatar(profile, displayName, f.pubkey);

  const info = document.createElement('div');
  info.className = 'follow-info';

  const nameEl = document.createElement('span');
  nameEl.className = 'follow-pubkey';
  nameEl.textContent = displayName;
  nameEl.title = f.pubkey;
  info.appendChild(nameEl);
  if (verifiedIdentities.has(f.pubkey)) info.appendChild(createVerifiedBadge(verifiedIdentities.get(f.pubkey)));

  const petnameInput = document.createElement('input');
  petnameInput.type = 'text';
  petnameInput.className = 'petname-input';
  petnameInput.value = f.petname || '';
  petnameInput.placeholder = 'Add petname…';
  bindSaveOnBlurOrEnter(petnameInput, async () => {
    const newPetname = petnameInput.value.trim();
    if (newPetname === (f.petname || '')) return;
    await onPetnameChange(f, newPetname);
  });

  const relayInput = document.createElement('input');
  relayInput.type = 'text';
  relayInput.className = 'petname-input';
  relayInput.value = f.relay || '';
  relayInput.placeholder = 'Relay hint (wss://…)';
  bindSaveOnBlurOrEnter(relayInput, async () => {
    const newRelay = relayInput.value.trim();
    if (newRelay === (f.relay || '')) return;
    if (newRelay && !isValidRelayUrl(newRelay)) { relayInput.value = f.relay || ''; return; }
    await onRelayChange(f, newRelay);
  });

  const inputRow = document.createElement('div');
  inputRow.className = 'input-row';
  inputRow.append(petnameInput, relayInput);
  info.appendChild(inputRow);

  const unfollowBtn = document.createElement('button');
  unfollowBtn.className = 'btn-unfollow';
  unfollowBtn.textContent = 'Unfollow';
  unfollowBtn.addEventListener('click', () => onUnfollow(f.pubkey));

  item.append(avatar, info, unfollowBtn);
  return item;
}
