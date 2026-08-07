// Avatar picker: a preset gallery (no uploads to host). Shared by every surface
// that sets an avatar — the native-league team/crest pickers and the admin
// console's league crest — so the gallery can't drift between them.
//
// First-party Drip art (72 tiles cut from the owner's avatar sheets, served from
// public/avatars/ on our own domain — no third-party avatar CDN) + the 32 NFL
// team logos. Every URL is https, which is what the server's clean_avatar_url
// check requires (migration 0066).
import { useMemo } from 'react';
import { Img } from './ui';
import { NFL_CODES } from '../data/kdst';
import { DRIP_AVATARS, dripAvatarUrl } from '../data/dripAvatars';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 18 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };

export function avatarOptions(): string[] {
  return [
    ...DRIP_AVATARS.map(dripAvatarUrl),
    ...NFL_CODES.map((code) => `https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png`),
  ];
}

export function AvatarPicker({ title, onPick, onClose }: {
  title: string; onPick: (url: string | null) => void; onClose: () => void;
}) {
  const options = useMemo(() => avatarOptions(), []);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 420, maxHeight: '75vh', overflowY: 'auto' }}>
        <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 8, marginTop: 12 }}>
          {options.map((url) => (
            <button key={url} onClick={() => onPick(url)} title="use this avatar"
              style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8, padding: 4, cursor: 'pointer', lineHeight: 0 }}>
              {/* a CDN that can't be reached shows a dim placeholder, not a broken image */}
              <Img src={url} size={44} radius={6} fallback={<div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--surface)', border: '1px dashed var(--bd)' }} />} />
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
          <button onClick={() => onPick(null)} className="mono" style={{ ...linkBtn, color: 'var(--opp)' }}>remove avatar</button>
          <button onClick={onClose} className="mono" style={linkBtn}>cancel</button>
        </div>
      </div>
    </div>
  );
}
