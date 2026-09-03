import type { ReactNode } from 'react';

const SUSHI_SOURCE_URL = 'https://github.com/NicholaiVogel/sushi';
const SUSHI_LICENSE_URL = `${SUSHI_SOURCE_URL}/blob/main/LICENSE`;
const STRUDEL_SOURCE_URL = 'https://codeberg.org/uzu/strudel';
const STRUDEL_CONTRIBUTORS_URL = 'https://codeberg.org/uzu/strudel/activity/contributors';
const TIDALCYCLES_URL = 'https://tidalcycles.org/';

function ExternalLink({ href, children, label }: { href: string; children: ReactNode; label: string }) {
	return <a href={href} target="_blank" rel="noreferrer" aria-label={label}>{children}</a>;
}

export function AboutCredits() {
	return (
		<footer className="settings-menu-about" aria-label="About Sushi">
			<span className="settings-menu-about-heading">ABOUT / CREDITS</span>
			<nav className="settings-menu-about-links" aria-label="Sushi source and credits">
				<ExternalLink href={SUSHI_SOURCE_URL} label="Sushi source code">Sushi source</ExternalLink>
				<span aria-hidden="true">·</span>
				<ExternalLink href={STRUDEL_SOURCE_URL} label="Strudel source code">Strudel</ExternalLink>
				<span aria-hidden="true">·</span>
				<ExternalLink href={TIDALCYCLES_URL} label="TidalCycles website">TidalCycles</ExternalLink>
			</nav>
			<p className="settings-menu-about-notice">
				<ExternalLink href={STRUDEL_CONTRIBUTORS_URL} label="Strudel contributors">Copyright (C) Strudel contributors</ExternalLink>
			</p>
			<p className="settings-menu-about-license">
				<ExternalLink href={SUSHI_LICENSE_URL} label="Sushi GNU Affero General Public License">AGPL-3.0-or-later</ExternalLink>
				<span aria-hidden="true"> · </span>
				<span>No warranty</span>
			</p>
		</footer>
	);
}
