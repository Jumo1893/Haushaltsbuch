import { dateFormat, daysBetween, money, parseDate, today } from "../format";
import { Link } from "../router";
import { kindLabel, type Account } from "../types";
import Sparkline from "./charts/Sparkline";

/** Ab so vielen Tagen ohne neue Buchung nennt die Karte das Alter statt des Datums */
const STALE_DAYS = 30;

function lastBooking(date: string | null) {
  if (!date) return "Noch keine Buchungen";
  const days = daysBetween(date, today());
  return days > STALE_DAYS ? `Letzte Buchung vor ${days} Tagen` : `Letzte Buchung ${dateFormat.format(parseDate(date))}`;
}

interface Props {
  account: Account;
  color: string;
  /** Kontostände am Ende der letzten Monate, für den kleinen Verlauf */
  balances: number[];
}

/** Konto in der Übersicht: Kontostand, Verlauf und Stand der Daten; führt zur Seite des Kontos */
export default function AccountCard({ account, color, balances }: Props) {
  return (
    <Link to={`/konten/${account.id}`} className="card">
      <span className="card-name">
        <span className="dot-key" style={{ background: color }} />
        <span>{account.name}</span>
      </span>
      <small className="meta">{[kindLabel(account.kind), account.institution].filter(Boolean).join(" · ")}</small>
      <span className="card-balance">{money(account.balance)}</span>
      <Sparkline values={balances} color={color} />
      <small className="meta">
        {lastBooking(account.lastDate)}
        {account.bankBalance === null && account.transactionCount > 0 && " · nicht abgeglichen"}
      </small>
    </Link>
  );
}
