// Text moderation for profile descriptions, macro descriptions and reviews.
// A word list catches the obvious; anything that slips through can be reported and
// removed by staff from the owner panel.
import { HttpError } from './util.ts'

const BLOCKED = [
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'tranny', 'kike', 'spic', 'chink', 'coon', 'wetback',
  'cunt', 'whore', 'slut', 'rape', 'rapist', 'pedo', 'pedophile', 'nazi', 'kys', 'kill yourself',
  'porn', 'nsfw', 'onlyfans', 'nudes', 'sex', 'cock', 'dick', 'pussy', 'penis', 'vagina', 'hentai'
]
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' }

function fold(text: string): string {
  return text.toLowerCase().replace(/[01345 7@$!]/g, (c) => (c === ' ' ? ' ' : LEET[c] ?? c)).replace(/(.)\1{2,}/g, '$1$1')
}

export function moderate(text: string, field: string): string {
  const folded = fold(text)
  const squashed = folded.replace(/[^a-z]/g, '')
  for (const w of BLOCKED) {
    const re = new RegExp(`(^|[^a-z])${w.replace(/ /g, '[^a-z]*')}($|[^a-z])`)
    if (re.test(folded) || (w.length >= 5 && squashed.includes(w.replace(/ /g, '')))) {
      throw new HttpError(400, `${field} contains words that are not allowed. Change it and try again.`)
    }
  }
  if (/(https?:\/\/|www\.)\S+/i.test(text) && !/(roblox\.com|lugerhub\.fun)/i.test(text)) {
    throw new HttpError(400, `${field} can only link to roblox.com or lugerhub.fun.`)
  }
  if (/\b(discord\.gg|discord\.com\/invite)\b/i.test(text)) throw new HttpError(400, `${field} cannot contain invite links.`)
  return text.replace(/[\u0000-\u0008\u000B-\u001F‮]/g, '')
}
