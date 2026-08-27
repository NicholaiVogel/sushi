import type { RefObject } from 'react';
import type { SourceBlockSummary } from '../../lib/project/model';

export interface TrackContextMenuProps {
	track: SourceBlockSummary;
	trackNumber: number;
	position: { x: number; y: number };
	menuRef: RefObject<HTMLDivElement | null>;
	onRename: (trackId: string) => void;
	onDelete: (trackId: string) => void;
}

export function TrackContextMenu({ track, trackNumber, position, menuRef, onRename, onDelete }: TrackContextMenuProps) {
	return (
		<div className="track-context-menu" ref={menuRef} style={{ left: position.x, top: position.y }} role="menu" aria-label={`${track.name} track actions`}>
			<div className="track-context-heading">TRACK {trackNumber.toString().padStart(2, '0')} · {track.name}</div>
			<button type="button" role="menuitem" onClick={() => onRename(track.id)}>Rename track</button>
			<button className="track-context-delete" type="button" role="menuitem" onClick={() => onDelete(track.id)}>Delete track <span aria-hidden="true">⌫</span></button>
		</div>
	);
}
