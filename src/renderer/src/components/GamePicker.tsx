import { Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/bridge'
import { cacheGames } from '../lib/state'
import { GameIcon } from './identity'

export interface PickedGame { universeId: number; placeId: number; name: string; controls?: Record<string, string> }

export default function GamePicker({ value, onChange }: { value: PickedGame | null; onChange: (g: PickedGame | null) => void }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true)
    const t = setTimeout(() => {
      const req = q.trim() ? api('games.search', { q: q.trim() }) : api('games.macroFriendly')
      req.then((r) => { if (live) { cacheGames(r.games); setList(r.games) } }).catch(() => live && setList([])).finally(() => live && setLoading(false))
    }, q ? 350 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [q])

  if (value) {
    return (
      <div className="picked">
        <GameIcon game={list.find((g) => g.universe_id === value.universeId) ?? { name: value.name }} size={32} radius={7} />
        <b className="grow ellipsis">{value.name}</b>
        <button className="btn ghost icon sm" aria-label="Change game" onClick={() => onChange(null)}><X size={14} /></button>
      </div>
    )
  }
  return (
    <div className="picker">
      <div className="search"><Search size={15} /><input className="input" placeholder="Search for the game" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="picker-list" role="listbox" aria-busy={loading}>
        {list.slice(0, 12).map((g) => (
          <button key={g.universe_id} role="option" aria-selected={false} onClick={() => onChange({ universeId: g.universe_id, placeId: g.root_place_id, name: g.name, controls: g.controls })}>
            <GameIcon game={g} size={30} radius={7} /><span className="ellipsis">{g.name}</span>
          </button>
        ))}
        {!loading && !list.length && <span className="muted small" style={{ padding: 8 }}>No games found.</span>}
      </div>
    </div>
  )
}
