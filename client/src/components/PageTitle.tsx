import type { ReactNode } from 'react';
import { useApp } from '../App';
import SportIcon from './SportIcon';

/**
 * The heading of a page about a team: the team's name, largest, with its sport's ball beside it,
 * and under it the name of the part of the app being looked at.
 */
export default function PageTitle({ children }: { children: ReactNode }) {
  const { team, sport } = useApp();
  return (
    <>
      {team && (
        <p className="team-title">
          <SportIcon sport={sport?.name} size={34} />
          <span>{team.name}</span>
          {team.season && <span className="team-title-season">{team.season}</span>}
        </p>
      )}
      <h1 className="section-name">{children}</h1>
    </>
  );
}
