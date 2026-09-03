import type { RefObject } from 'react';
import type { SourceBlockSummary } from '../../lib/project/model';
import { DEFAULT_TRACK_COLOR } from './helpers';
import { ColorPicker } from './ColorPicker';
import type { TrackDetails } from './types';

export interface TrackContextMenuProps {
	track: SourceBlockSummary;
	trackNumber: number;
	position: { x: number; y: number };
	menuRef: RefObject<HTMLDivElement | null>;
	trackDetails?: TrackDetails;
	onRename: (trackId: string) => void;
	onOpenNoteEditor: (trackId: string) => void;
	onDelete: (trackId: string) => void;
	onSetColor: (trackId: string, value: string) => void;
}

export function TrackContextMenu({ track, trackNumber, position, menuRef, trackDetails, onRename, onOpenNoteEditor, onDelete, onSetColor }: TrackContextMenuProps) {
	return (
		<div className="track-context-menu" ref={menuRef} style={{ left: position.x, top: position.y }} role="menu" aria-label={`${track.name} track actions`}>
			<div className="track-context-heading">TRACK {trackNumber.toString().padStart(2, '0')} · {track.name}</div>
			<div className="track-context-color" role="group" aria-label={`${track.name} color settings`}>
				<ColorPicker
					value={trackDetails?.color ?? DEFAULT_TRACK_COLOR}
					defaultValue={DEFAULT_TRACK_COLOR}
					label={track.name}
					variant="inline"
					disabled={!trackDetails?.colorEditable}
					onChange={(value) => onSetColor(track.id, value)}
				/>
			</div>
			<button type="button" role="menuitem" onClick={() => onOpenNoteEditor(track.id)}>Open note editor <span aria-hidden="true">♫</span></button>
			<button type="button" role="menuitem" onClick={() => onRename(track.id)}>Rename track</button>
			<button className="track-context-delete" type="button" role="menuitem" onClick={() => onDelete(track.id)}>Delete track <span aria-hidden="true">⌫</span></button>
		</div>
	);
}
