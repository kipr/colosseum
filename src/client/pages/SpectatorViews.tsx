import { useCallback, useMemo } from 'react';
import {
  useLoaderData,
  useNavigate,
  useParams,
  useRouteLoaderData,
  useSearchParams,
} from 'react-router-dom';
import BracketLikeView from '../components/bracket/BracketLikeView';
import BracketRankingView from '../components/bracket/BracketRankingView';
import { getBracketWinner } from '../components/bracket/bracketUtils';
import DocumentationScoresDisplay from '../components/documentation/DocumentationScoresDisplay';
import DoubleSeedingDisplay from '../components/doubleSeeding/DoubleSeedingDisplay';
import OverallScoresDisplay, {
  type OverallRow,
} from '../components/overall/OverallScoresDisplay';
import SeedingDisplay from '../components/seeding/SeedingDisplay';
import SpectatorAutomaticAwards, {
  hasAutomaticAwardsContent,
} from '../components/spectator/SpectatorAutomaticAwards';
import type {
  SpectatorAwardsLoaderData,
  SpectatorBracketRankingsLoaderData,
  SpectatorDocumentationLoaderData,
  SpectatorDoubleSeedingLoaderData,
  SpectatorEventLoaderData,
  SpectatorSeedingLoaderData,
} from '../loaders/spectatorLoaders';
import type { BracketDetail, BracketSide } from '../types/brackets';
import {
  bracketSideToParam,
  isBracketSide,
  paramToBracketSide,
  spectatorBracketPath,
} from '../utils/routes';
import '../components/bracket/BracketDisplay.css';

function useEventData(): SpectatorEventLoaderData {
  return useRouteLoaderData('spectator-event') as SpectatorEventLoaderData;
}

function BracketSelector({ rankings = false }: { rankings?: boolean }) {
  const { event, brackets } = useEventData();
  const { bracketId } = useParams();
  const navigate = useNavigate();

  if (brackets.length <= 1) return null;

  return (
    <div className="spectator-bracket-selector">
      <label
        htmlFor={rankings ? 'spectator-rankings-bracket' : 'spectator-bracket'}
      >
        Bracket
      </label>
      <select
        id={rankings ? 'spectator-rankings-bracket' : 'spectator-bracket'}
        value={bracketId ?? ''}
        onChange={(changeEvent) =>
          navigate(
            spectatorBracketPath(
              event.id,
              changeEvent.target.value,
              rankings ? 'rankings' : 'bracket',
            ),
          )
        }
      >
        {brackets.map((bracket) => (
          <option key={bracket.id} value={bracket.id}>
            {bracket.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SpectatorSeedingView() {
  const { event } = useEventData();
  const { teams, scores, rankings } =
    useLoaderData() as SpectatorSeedingLoaderData;
  const effectiveRounds = event.seeding_rounds > 0 ? event.seeding_rounds : 3;

  return (
    <div className="spectator-seeding-view">
      <SeedingDisplay
        teams={teams}
        scores={scores}
        rankings={rankings}
        effectiveRounds={effectiveRounds}
        variant="spectator"
      />
    </div>
  );
}

export function SpectatorDoubleSeedingView() {
  const { event } = useEventData();
  const { teams, scores, rankings } =
    useLoaderData() as SpectatorDoubleSeedingLoaderData;

  return (
    <div className="spectator-seeding-view">
      <DoubleSeedingDisplay
        teams={teams}
        scores={scores}
        rankings={rankings}
        effectiveRounds={event.double_seeding_rounds}
        variant="spectator"
      />
    </div>
  );
}

export function SpectatorNoBracketsView() {
  return (
    <div className="card">
      <p className="spectator-muted-message">
        No brackets available for this event.
      </p>
    </div>
  );
}

export function SpectatorBracketView() {
  const bracket = useRouteLoaderData('spectator-bracket') as BracketDetail;
  const [searchParams, setSearchParams] = useSearchParams();
  const sideParam = searchParams.get('side');
  const bracketSide: BracketSide | undefined = isBracketSide(sideParam)
    ? paramToBracketSide(sideParam)
    : undefined;
  const handleSideChange = useCallback(
    (side: BracketSide) => {
      setSearchParams({ side: bracketSideToParam(side) }, { replace: true });
    },
    [setSearchParams],
  );
  const winner = useMemo(
    () => (bracket.games.length > 0 ? getBracketWinner(bracket.games) : null),
    [bracket.games],
  );

  return (
    <div>
      <BracketSelector />
      <div className="card bracket-section">
        {winner && (
          <div className="bracket-winner-banner bracket-winner-bracket-view">
            <span className="bracket-winner-trophy" aria-hidden>
              🏆
            </span>
            <span className="bracket-winner-label">Champion</span>
            <span className="bracket-winner-team">
              <strong>{winner.team_number}</strong>{' '}
              {winner.team_name ||
                winner.team_display ||
                `Team ${winner.team_id}`}
            </span>
          </div>
        )}
        <BracketLikeView
          games={bracket.games}
          side={bracketSide}
          onSideChange={handleSideChange}
          emptyMessage="No bracket games available yet."
        />
      </div>
    </div>
  );
}

export function SpectatorDocumentationView() {
  const { categories, scores } =
    useLoaderData() as SpectatorDocumentationLoaderData;
  return (
    <div className="spectator-documentation-view">
      <DocumentationScoresDisplay
        categories={categories}
        scores={scores}
        variant="spectator"
      />
    </div>
  );
}

export function SpectatorAwardsView() {
  const { manual, automatic } = useLoaderData() as SpectatorAwardsLoaderData;
  const hasAutomatic = hasAutomaticAwardsContent(automatic);

  if (manual.length === 0 && !hasAutomatic) {
    return (
      <div className="card">
        <p className="spectator-muted-message">
          No awards have been published for this event.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="spectator-awards-title">Awards</h3>
      {automatic && hasAutomatic && (
        <SpectatorAutomaticAwards automatic={automatic} />
      )}
      {manual.length > 0 && (
        <div
          className={`spectator-manual-awards${hasAutomatic ? ' spectator-manual-awards-with-automatic' : ''}`}
        >
          {hasAutomatic && (
            <h4 className="spectator-awards-subtitle">Other awards</h4>
          )}
          {manual.map((award, awardIndex) => (
            <div
              key={`${award.name}-${awardIndex}`}
              className="spectator-manual-award"
              data-has-divider={awardIndex < manual.length - 1}
            >
              <strong className="spectator-manual-award-title">
                {award.name}
              </strong>
              {award.description && (
                <p className="spectator-manual-award-description">
                  {award.description}
                </p>
              )}
              {award.recipients.length > 0 ||
              award.individual_recipients.length > 0 ? (
                <ul className="spectator-manual-award-recipients">
                  {award.recipients.map((recipient, recipientIndex) => (
                    <li
                      key={`team-${recipient.team_number}-${recipientIndex}`}
                      className="spectator-manual-award-recipient"
                    >
                      <strong>#{recipient.team_number}</strong>{' '}
                      <span className="spectator-manual-award-recipient-name">
                        {recipient.display_name?.trim()
                          ? recipient.display_name
                          : recipient.team_name}
                      </span>
                    </li>
                  ))}
                  {award.individual_recipients.map(
                    (recipient, recipientIndex) => {
                      const teamLabel =
                        recipient.team_number != null
                          ? `#${recipient.team_number} ${
                              recipient.display_name?.trim()
                                ? recipient.display_name
                                : (recipient.team_name ?? '')
                            }`.trim()
                          : null;
                      return (
                        <li
                          key={`individual-${recipient.name}-${recipient.team_number ?? 'none'}-${recipientIndex}`}
                          className="spectator-manual-award-recipient"
                        >
                          <span className="spectator-manual-award-recipient-name">
                            {recipient.name}
                          </span>
                          {teamLabel && (
                            <span className="spectator-manual-award-recipient-team">
                              {' '}
                              · {teamLabel}
                            </span>
                          )}
                        </li>
                      );
                    },
                  )}
                </ul>
              ) : (
                <p className="spectator-manual-award-empty">No recipients</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SpectatorBracketRankingsView() {
  const { bracketId } = useParams();
  const { entries, weight } =
    useLoaderData() as SpectatorBracketRankingsLoaderData;
  return (
    <div className="spectator-bracket-rankings-view">
      <BracketSelector rankings />
      <BracketRankingView
        bracketId={Number(bracketId)}
        rankings={entries}
        weight={weight}
        loading={false}
        variant="spectator"
      />
    </div>
  );
}

export function SpectatorOverallView() {
  const { event } = useEventData();
  const rows = useLoaderData() as OverallRow[];
  return (
    <div className="spectator-overall-view">
      <OverallScoresDisplay
        rows={rows}
        variant="spectator"
        showDoubleSeeding={event.double_seeding_rounds > 0}
      />
    </div>
  );
}
