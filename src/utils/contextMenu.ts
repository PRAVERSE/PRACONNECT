// src/utils/contextMenu.ts
// Pure helpers behind the message/conversation context menus (desktop
// right-click + mobile long-press). Kept free of React/DOM so the menu
// math, item building, delete eligibility, and long-press tracking are
// unit-testable with node:test.

export const DELETE_FOR_EVERYONE_WINDOW_MS = 15 * 60 * 1000;

/** Canonical conversation key for a user pair — mirrors the server's
 *  conversationIdFor (sorted ids joined with ':'). */
export function conversationKeyFor(a: string, b: string): string {
  return [a, b].sort().join(':');
}

// ─── Positioning ─────────────────────────────────────────────────────────────

export interface MenuPosition {
  x: number;
  y: number;
}

/** Position a fixed menu near (x, y). Preferred placement is below-right;
 *  when the menu would overflow the viewport it flips above / shifts left
 *  and is always clamped inside `margin` of every edge. */
export function clampMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 8
): MenuPosition {
  const width = Math.max(menuWidth, 0);
  const height = Math.max(menuHeight, 0);
  let left = x;
  let top = y;

  if (left + width > viewportWidth - margin) left = viewportWidth - width - margin;
  if (top + height > viewportHeight - margin) top = y - height;
  if (top < margin) top = margin;
  left = Math.min(Math.max(left, margin), Math.max(margin, viewportWidth - width - margin));
  top = Math.min(Math.max(top, margin), Math.max(margin, viewportHeight - height - margin));
  return { x: left, y: top };
}

// ─── Menu item model ─────────────────────────────────────────────────────────

/** Serializable (icon-free) menu item built by the pure builders below.
 *  The caller attaches lucide icons when rendering. */
export interface ContextMenuItem {
  id: string;
  label: string;
  danger?: boolean;
  separatorBefore?: boolean;
  disabled?: boolean;
  submenu?: ContextMenuItem[];
}

// ─── Message context menu ────────────────────────────────────────────────────

export interface ContextMenuMessage {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
  deletedForEveryone: boolean;
}

export interface MessageMenuOptions {
  myId: string;
  nowMs: number;
  isPinned: boolean;
  isStarred: boolean;
}

/** The server keeps delete-for-everyone locked to the original sender for a
 *  15-minute window. The menu mirrors that rule so the option only appears
 *  when the server would accept it. */
export function canDeleteForEveryone(message: ContextMenuMessage, myId: string, nowMs: number): boolean {
  if (message.deletedForEveryone) return false;
  if (message.senderId !== myId) return false;
  const createdAt = Date.parse(message.createdAt);
  if (Number.isNaN(createdAt)) return false;
  return nowMs - createdAt <= DELETE_FOR_EVERYONE_WINDOW_MS;
}

export interface DeleteOptions {
  /** "Delete for me" is always offered for any visible message. */
  canDeleteForMe: boolean;
  canDeleteForEveryone: boolean;
}

export function deleteOptionsFor(message: ContextMenuMessage, myId: string, nowMs: number): DeleteOptions {
  return {
    canDeleteForMe: !message.deletedForEveryone,
    canDeleteForEveryone: canDeleteForEveryone(message, myId, nowMs),
  };
}

export function pinMessageToggleLabel(isPinned: boolean): string {
  return isPinned ? 'Unpin message' : 'Pin message';
}

export function starToggleLabel(isStarred: boolean): string {
  return isStarred ? 'Unstar' : 'Star';
}

/** WhatsApp-style message context menu. A message deleted for everyone is
 *  only offerable for info/select/delete (no body left to reply to). */
export function buildMessageMenuItems(message: ContextMenuMessage, options: MessageMenuOptions): ContextMenuItem[] {
  const { canDeleteForEveryone: canDeleteAll } = deleteOptionsFor(message, options.myId, options.nowMs);
  const hasBody = !message.deletedForEveryone && message.text.length > 0;

  const items: ContextMenuItem[] = [
    { id: 'info', label: 'Message info' },
  ];

  if (!message.deletedForEveryone) {
    const isSender = message.senderId === options.myId;
    const isWithinEditWindow = options.nowMs - Date.parse(message.createdAt) <= 15 * 60 * 1000;
    const canEdit = isSender && isWithinEditWindow;

    items.push(
      { id: 'reply', label: 'Reply', disabled: !hasBody },
      { id: 'copy', label: 'Copy', disabled: !hasBody },
      { id: 'forward', label: 'Forward', disabled: !hasBody },
      ...(canEdit ? [{ id: 'edit', label: 'Edit message' }] : []),
      { id: 'pin', label: pinMessageToggleLabel(options.isPinned) },
      { id: 'star', label: starToggleLabel(options.isStarred) },
    );
  }

  items.push({ id: 'select', label: 'Select' });

  const deleteItem: ContextMenuItem = {
    id: 'delete',
    label: 'Delete',
    danger: true,
    separatorBefore: true,
    submenu: [
      { id: 'delete-for-me', label: 'Delete for me', danger: true },
      ...(canDeleteAll ? [{ id: 'delete-for-everyone', label: 'Delete for everyone', danger: true }] : []),
    ],
  };
  items.push(deleteItem);
  return items;
}

// ─── Conversation context menu ───────────────────────────────────────────────

export interface ContextMenuConversation {
  friendId: string;
  name: string;
  archived: boolean;
  pinned: boolean;
  favourite: boolean;
  locked: boolean;
  unreadCount: number;
}

export interface ContextMenuList {
  id: string;
  name: string;
  conversationIds: string[];
}

export interface ConversationMenuOptions {
  /** Canonical conversation key (conversationKeyFor) of the target pair. */
  conversationKey: string;
  lists: ContextMenuList[];
}

export function archiveToggleLabel(isArchived: boolean): string {
  return isArchived ? 'Unarchive' : 'Archive';
}

export function chatPinToggleLabel(isPinned: boolean): string {
  return isPinned ? 'Unpin chat' : 'Pin chat';
}

export function favouriteToggleLabel(isFavourite: boolean): string {
  return isFavourite ? 'Remove from favourites' : 'Add to favourites';
}

export function readToggleLabel(unreadCount: number): string {
  return unreadCount > 0 ? 'Mark as read' : 'Mark as unread';
}

export function lockToggleLabel(isLocked: boolean): string {
  return isLocked ? 'Unlock chat' : 'Lock chat';
}

/** WhatsApp-style conversation context menu. */
export function buildConversationMenuItems(conversation: ContextMenuConversation, options: ConversationMenuOptions): ContextMenuItem[] {
  const listItems: ContextMenuItem[] = options.lists.map((list) => {
    const member = list.conversationIds.includes(options.conversationKey);
    return { id: `list:${list.id}`, label: `${member ? 'Remove from' : 'Add to'} ${list.name}`, disabled: false };
  });
  listItems.push({ id: 'list:new', label: 'New list' });

  return [
    { id: 'archive', label: archiveToggleLabel(conversation.archived) },
    { id: 'lock', label: lockToggleLabel(conversation.locked) },
    { id: 'pin', label: chatPinToggleLabel(conversation.pinned) },
    { id: 'read', label: readToggleLabel(conversation.unreadCount) },
    { id: 'favourite', label: favouriteToggleLabel(conversation.favourite) },
    { id: 'lists', label: 'Add to list', submenu: listItems },
    { id: 'clear', label: 'Clear chat', danger: true, separatorBefore: true },
    { id: 'delete', label: 'Delete chat', danger: true },
  ];
}

// ─── Selection mode helpers ──────────────────────────────────────────────────

export function toggleSelection(id: string, selectedIds: string[]): string[] {
  return selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id];
}

export function selectionCount(selectedIds: string[]): number {
  return selectedIds.length;
}

// ─── Long-press tracking (framework-free, injectable timers) ─────────────────

export interface LongPressTracker {
  onStart(x: number, y: number): void;
  onMove(x: number, y: number): void;
  /** Ends the gesture. Returns whether the long press fired, plus the last
   *  known position so the caller can position its menu. */
  onEnd(): { triggered: boolean; x: number; y: number };
  onCancel(): void;
}

export interface LongPressTrackerOptions {
  /** Hold duration before the press fires. */
  delay?: number;
  /** Movement tolerance before the hold is treated as a scroll/drag. */
  tolerance?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => LongPressTimerHandle;
  clear?: (handle: LongPressTimerHandle) => void;
  onTrigger?: (x: number, y: number) => void;
}

/** Injected timers may return a setTimeout handle or a plain function (the
 *  unit tests hand back the callback itself). */
export type LongPressTimerHandle = ReturnType<typeof setTimeout> | (() => void);

export function createLongPressTracker(options: LongPressTrackerOptions = {}): LongPressTracker {
  const delay = options.delay ?? 600;
  const tolerance = options.tolerance ?? 10;
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clear = options.clear ?? ((handle: LongPressTimerHandle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let armed = false;
  let triggered = false;
  let timer: LongPressTimerHandle | null = null;

  const fire = () => {
    timer = null;
    if (!armed) return;
    armed = false;
    triggered = true;
    options.onTrigger?.(lastX, lastY);
  };

  const disarm = () => {
    if (timer !== null) {
      clear(timer);
      timer = null;
    }
    armed = false;
  };

  return {
    onStart(x, y) {
      if (timer !== null) clear(timer);
      startX = x;
      startY = y;
      lastX = x;
      lastY = y;
      armed = true;
      triggered = false;
      const startT = now();
      timer = schedule(() => {
        if (armed && now() - startT >= delay) fire();
      }, delay);
    },
    onMove(x, y) {
      lastX = x;
      lastY = y;
      if (!armed) return;
      const dx = x - startX;
      const dy = y - startY;
      if (Math.hypot(dx, dy) > tolerance) disarm();
    },
    onEnd() {
      disarm();
      return { triggered, x: lastX, y: lastY };
    },
    onCancel() {
      disarm();
      triggered = false;
    },
  };
}