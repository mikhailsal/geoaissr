import type { ParticipantColorId } from '$shared/colors';
import type { ClientViewState, ServerMessage } from '$shared/protocol';
import { RU } from '../i18n/ru';
import {
  getOrCreateProfileId,
  loadSavedProfile,
  saveProfile,
  type SavedUserProfile,
} from './profile';
import type { StoredProfile } from '$shared/storage-schemas';
import type { GeoWsClient } from './ws-client';
import {
  audioProfileAck,
  bindAudioProfile,
  clearAudioProfile,
  disconnectAudioProfile,
} from './audio-settings.svelte';

/** Coordinates profile persistence with join state and acknowledged profile edits. */
export class ProfileSession {
  saved = $state<SavedUserProfile | null>(loadSavedProfile());
  error = $state<string | null>(null);
  pending = $state(false);
  private pendingEdit: (SavedUserProfile & { seq: number }) | null = null;
  private pendingJoin: SavedUserProfile | null = null;
  private restoredProfileId: string | null = null;

  constructor(private readonly client: GeoWsClient) {}

  accept(profile: StoredProfile): void {
    this.saved = {
      version: 2,
      profileId: profile.profileId,
      profileToken: profile.profileToken,
      nick: profile.nick,
      color: profile.color,
    };
    saveProfile(this.saved);
    this.pendingJoin = null;
    this.restoredProfileId = null;
    bindAudioProfile(profile, (preferences) =>
      this.client.sendSequencedWithSeq('update_audio_preferences', { preferences }),
    );
  }

  reset(): void {
    this.clearPending();
    clearAudioProfile();
    this.saved = null;
    this.error = null;
  }

  join(nick: string, color: ParticipantColorId): boolean {
    this.pendingJoin = { profileId: getOrCreateProfileId(), nick: nick.trim(), color };
    if (this.client.sendJoin(nick, color, loadSavedProfile()?.profileId)) return true;
    this.pendingJoin = null;
    return false;
  }

  cancelJoin(): void {
    this.pendingJoin = null;
  }

  restore(profileId: string): void {
    this.restoredProfileId = profileId;
  }

  onState(view: ClientViewState): void {
    const me = view.players.find((p) => p.id === view.viewerId);
    if (!me) return;
    const profileId = this.restoredProfileId ?? this.pendingJoin?.profileId;
    if (!profileId) return;
    this.saved = { ...this.saved, profileId, nick: me.name, color: me.color };
    saveProfile(this.saved);
    this.pendingJoin = null;
    this.restoredProfileId = null;
  }

  update(nick: string, color: ParticipantColorId): void {
    this.error = null;
    const result = this.client.sendSequencedWithSeq('update_profile', { nick, color });
    if (!result.sent) {
      this.error = RU.join.serverUnreachable;
      return;
    }
    this.pending = true;
    this.pendingEdit = {
      ...this.saved,
      profileId: this.saved?.profileId ?? getOrCreateProfileId(),
      nick: nick.trim(),
      color,
      seq: result.seq,
    };
  }

  onAck(msg: Extract<ServerMessage, { type: 'ack' }>): void {
    audioProfileAck(msg);
    if (this.pendingEdit?.seq !== msg.seq) return;
    const edit = this.pendingEdit;
    this.pendingEdit = null;
    this.pending = false;
    if (msg.result === 'ok') {
      this.saved = { ...this.saved, profileId: edit.profileId, nick: edit.nick, color: edit.color };
      saveProfile(this.saved);
    } else this.error = msg.message || 'Не удалось изменить профиль. Проверьте имя и цвет.';
  }

  clearPending(): void {
    disconnectAudioProfile();
    if (this.pending) this.error = RU.join.serverUnreachable;
    this.pending = false;
    this.pendingEdit = null;
    this.pendingJoin = null;
    this.restoredProfileId = null;
  }
}
