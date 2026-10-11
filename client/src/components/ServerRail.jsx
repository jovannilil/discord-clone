import { PlusIcon, LogoIcon } from "./icons.jsx";

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();

export const HOME = "@me";

export default function ServerRail({ servers, activeId, onSelect, onAdd, homeBadge }) {
  return (
    <nav className="rail" aria-label="Servers">
      <button
        className={`rail-icon home ${activeId === HOME ? "active" : ""}`}
        title="Home: friends and direct messages"
        onClick={() => onSelect(HOME)}
      >
        <LogoIcon size={26} />
        {homeBadge > 0 && <span className="rail-badge">{homeBadge > 99 ? "99+" : homeBadge}</span>}
      </button>
      <div className="rail-sep" />
      {servers.map((s) => (
        <button
          key={s.id}
          className={`rail-icon ${s.id === activeId ? "active" : ""}`}
          title={s.name}
          onClick={() => onSelect(s.id)}
        >
          {initials(s.name)}
        </button>
      ))}
      {servers.length > 0 && <div className="rail-sep" />}
      <button className="rail-icon add" title="Create or join a server" onClick={onAdd}>
        <PlusIcon size={22} />
      </button>
    </nav>
  );
}
