import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

export type OnboardingWebMcpStatus = 'ready' | 'connecting' | 'unavailable';

export const ONBOARDING_AGENT_PROMPT = 'Inspect this project, add a complementary bassline after cycle 8, validate the source, and play the result.';

interface OnboardingModalProps {
	webmcpStatus: OnboardingWebMcpStatus;
	restoredProjectPresent: boolean;
	onPrepareDemo: () => Promise<boolean>;
	onPlayPreparedDemo: () => void;
	onStartBlank: (confirmed?: boolean) => Promise<boolean>;
	onOpenExisting?: () => void;
	onClose: () => void;
}

type ConceptPreview = 'arrangement' | 'source' | 'agent';

const CONCEPTS: ReadonlyArray<{
	label: string;
	description: string;
	color: string;
	preview: ConceptPreview;
}> = [
	{
		label: 'VISUAL ARRANGEMENT',
		description: 'Build with tracks, regions, sounds, and effects.',
		color: 'var(--onboarding-orange)',
		preview: 'arrangement',
	},
	{
		label: 'STRUDEL SOURCE',
		description: 'Edit the composition directly as programmable music.',
		color: 'var(--onboarding-purple)',
		preview: 'source',
	},
	{
		label: 'WEBMCP AGENT',
		description: 'Let an agent inspect, modify, validate, and play the project.',
		color: 'var(--onboarding-magenta)',
		preview: 'agent',
	},
];

const FOCUSABLE_SELECTOR = [
	'button:not([disabled])',
	'[href]',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])',
].join(', ');

export function OnboardingModal({
	webmcpStatus,
	restoredProjectPresent,
	onPrepareDemo,
	onPlayPreparedDemo,
	onStartBlank,
	onOpenExisting,
	onClose,
}: OnboardingModalProps) {
	const modalRef = useRef<HTMLDivElement | null>(null);
	const primaryActionRef = useRef<HTMLButtonElement | null>(null);
	const previouslyFocusedRef = useRef<HTMLElement | null>(null);
	const copyResetTimerRef = useRef<number | null>(null);
	const mountedRef = useRef(true);
	const [busyAction, setBusyAction] = useState<'demo' | 'blank' | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [blankConfirmationOpen, setBlankConfirmationOpen] = useState(false);
	const [copyState, setCopyState] = useState<'idle' | 'copied' | 'unavailable'>('idle');

	useEffect(() => {
		mountedRef.current = true;
		const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		previouslyFocusedRef.current = activeElement && activeElement !== document.body && activeElement !== document.documentElement && activeElement.matches(FOCUSABLE_SELECTOR)
			? activeElement
			: document.querySelector<HTMLElement>('.topbar-help-button');
		const focusTimer = window.setTimeout(() => primaryActionRef.current?.focus(), 0);
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key !== 'Tab') return;

			const modal = modalRef.current;
			if (!modal) return;
			const focusable = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
			if (!focusable.length) {
				event.preventDefault();
				modal.focus();
				return;
			}

			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const active = document.activeElement;
			if (event.shiftKey && (active === first || !modal.contains(active))) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && (active === last || !modal.contains(active))) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => {
			mountedRef.current = false;
			window.clearTimeout(focusTimer);
			document.removeEventListener('keydown', handleKeyDown);
			if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
			if (previouslyFocusedRef.current?.isConnected) previouslyFocusedRef.current.focus();
			else document.querySelector<HTMLElement>('.topbar-help-button')?.focus();
		};
	}, [onClose]);

	const runDemo = useCallback(async () => {
		if (busyAction) return;
		setBusyAction('demo');
		setActionError(null);
		try {
			const prepared = await onPrepareDemo();
			if (!prepared) {
				if (mountedRef.current) setActionError('The demo source could not be validated. Your current project is still open.');
				return;
			}
			// Close is deliberately called before playback. The parent owns the
			// existing transport dispatch and starts it only after this validation.
			onClose();
			onPlayPreparedDemo();
		} catch (error) {
			if (mountedRef.current) setActionError(error instanceof Error ? error.message : 'The demo could not be loaded.');
		} finally {
			if (mountedRef.current) setBusyAction(null);
		}
	}, [busyAction, onClose, onPlayPreparedDemo, onPrepareDemo]);

	const runBlank = useCallback(async (confirmed = false) => {
		if (busyAction) return;
		if (restoredProjectPresent && !confirmed) {
			setActionError(null);
			setBlankConfirmationOpen(true);
			return;
		}
		setBusyAction('blank');
		setActionError(null);
		setBlankConfirmationOpen(false);
		try {
			const started = await onStartBlank(confirmed);
			if (started) onClose();
			else if (mountedRef.current) {
				setActionError(restoredProjectPresent
					? 'Your restored project was kept open. Use Settings to manage another project.'
					: 'A blank project could not be created.');
			}
		} catch (error) {
			if (mountedRef.current) setActionError(error instanceof Error ? error.message : 'A blank project could not be created.');
		} finally {
			if (mountedRef.current) setBusyAction(null);
		}
	}, [busyAction, onClose, onStartBlank, restoredProjectPresent]);

	const copyPrompt = useCallback(async () => {
		let copied = false;
		try {
			if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(ONBOARDING_AGENT_PROMPT);
				copied = true;
			}
		} catch {
			copied = false;
		}

		if (!copied && typeof document !== 'undefined') {
			const textarea = document.createElement('textarea');
			textarea.value = ONBOARDING_AGENT_PROMPT;
			textarea.setAttribute('readonly', '');
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.append(textarea);
			textarea.select();
			try {
				copied = document.execCommand('copy');
			} catch {
				copied = false;
			}
			textarea.remove();
		}

		if (!mountedRef.current) return;
		setCopyState(copied ? 'copied' : 'unavailable');
		if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
		copyResetTimerRef.current = window.setTimeout(() => {
			if (mountedRef.current) setCopyState('idle');
		}, 1600);
	}, []);

	const statusLabel = webmcpStatus === 'ready'
		? 'WEBMCP READY'
		: webmcpStatus === 'connecting' ? 'CONNECTING' : 'WEBMCP NOT DETECTED';

	return (
		<div
			className="onboarding-backdrop"
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				ref={modalRef}
				className="onboarding-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="onboarding-title"
				aria-describedby="onboarding-description"
				tabIndex={-1}
			>
				<div className="onboarding-modal-header">
					<div className="onboarding-heading">
						<span className="onboarding-eyebrow">// WELCOME TO SUSHI</span>
						<h1 id="onboarding-title">One composition. Three ways to make it.</h1>
						<p id="onboarding-description">Arrange visually, edit the Strudel source, or ask an agent to work directly in the project. Every supported change stays synchronized.</p>
					</div>
					<div className="onboarding-status-column">
						<span className={`onboarding-webmcp-status onboarding-webmcp-status-${webmcpStatus}`}>
							<span className="onboarding-status-dot" aria-hidden="true" />
							{statusLabel}
						</span>
						{webmcpStatus === 'unavailable' ? <p>WebMCP was not detected in this browser. The studio remains fully usable.</p> : null}
					</div>
					<button className="onboarding-close" type="button" onClick={onClose} aria-label="Close Welcome to Sushi" title="Close">
						<span aria-hidden="true">×</span>
					</button>
				</div>

				<div className="onboarding-concepts" aria-label="Three interfaces to one live project">
					{CONCEPTS.map((concept, index) => (
						<Fragment key={concept.label}>
							<OnboardingConcept {...concept} />
							{index < CONCEPTS.length - 1 ? <span className="onboarding-connector" aria-hidden="true">↔</span> : null}
						</Fragment>
					))}
				</div>

				<div className="onboarding-divider" aria-hidden="true"><span />ONE LIVE PROJECT<span /></div>

				<div className="onboarding-actions">
					<button ref={primaryActionRef} className="onboarding-action onboarding-action-primary" type="button" onClick={() => { void runDemo(); }} disabled={busyAction !== null}>
						<span className="onboarding-action-icon" aria-hidden="true">▶</span>
						{busyAction === 'demo' ? 'Loading demo…' : 'Play the demo'}
					</button>
					<button className="onboarding-action onboarding-action-secondary" type="button" onClick={() => { void runBlank(); }} disabled={busyAction !== null}>
						{busyAction === 'blank' ? 'Creating blank…' : 'Start blank'}
					</button>
					{onOpenExisting ? <button className="onboarding-action onboarding-action-tertiary" type="button" onClick={() => { onClose(); onOpenExisting(); }} disabled={busyAction !== null}>Open an existing project</button> : null}
				</div>
				{blankConfirmationOpen ? (
					<div className="onboarding-blank-confirm" role="alert">
						<p>This project was restored from local storage. Keep it and continue editing, or save it and open a new blank canvas?</p>
						<div className="onboarding-blank-confirm-actions">
							<button className="onboarding-action onboarding-action-confirm" type="button" onClick={() => { void runBlank(true); }} disabled={busyAction !== null}>Replace with blank</button>
							<button className="onboarding-action onboarding-action-cancel" type="button" onClick={() => setBlankConfirmationOpen(false)} disabled={busyAction !== null}>Keep current project</button>
						</div>
					</div>
				) : null}
				{actionError ? <p className="onboarding-action-error" role="alert">{actionError}</p> : null}

				<div className="onboarding-divider onboarding-divider-agent" aria-hidden="true"><span />TRY WITH AN AGENT<span /></div>
				<div className="onboarding-prompt-box">
					<code>{ONBOARDING_AGENT_PROMPT}</code>
					<button className="onboarding-copy" type="button" onClick={() => { void copyPrompt(); }}>
						<span aria-hidden="true">▣</span>
						{copyState === 'copied' ? 'Copied' : copyState === 'unavailable' ? 'Copy unavailable' : 'Copy'}
					</button>
				</div>
				<span className="sr-only" role="status" aria-live="polite">{copyState === 'copied' ? 'Prompt copied to clipboard.' : copyState === 'unavailable' ? 'The prompt could not be copied.' : ''}</span>
			</div>
		</div>
	);
}

function OnboardingConcept({ label, description, color, preview }: { label: string; description: string; color: string; preview: ConceptPreview }) {
	return (
		<article className="onboarding-concept" style={{ '--concept-color': color } as CSSProperties}>
			<div className="onboarding-concept-preview" aria-hidden="true">
				{preview === 'arrangement' ? <ArrangementPreview /> : preview === 'source' ? <SourcePreview /> : <AgentPreview />}
			</div>
			<strong>{label}</strong>
			<p>{description}</p>
		</article>
	);
}

function ArrangementPreview() {
	return (
		<div className="onboarding-arrangement-preview">
			<span className="onboarding-arrangement-grid" />
			<i className="onboarding-bar onboarding-bar-orange" />
			<i className="onboarding-bar onboarding-bar-yellow" />
			<i className="onboarding-bar onboarding-bar-magenta" />
			<i className="onboarding-bar onboarding-bar-purple" />
		</div>
	);
}

function SourcePreview() {
	return (
		<pre className="onboarding-source-preview"><span><b>1</b> n(chord)</span><span><b>2</b> .arp(order)</span><span><b>3</b> .scale(key)</span><span><b>4</b> .sound(<em>"supersaw"</em>)</span><span><b>5</b> .gain(gain)</span></pre>
	);
}

function AgentPreview() {
	return (
		<div className="onboarding-agent-preview">
			<span className="onboarding-agent-bubble onboarding-agent-bubble-user">add a bassline</span>
			<span className="onboarding-agent-bubble onboarding-agent-bubble-system">validating source…</span>
			<span className="onboarding-agent-bot" aria-hidden="true"><i /><i /></span>
		</div>
	);
}
