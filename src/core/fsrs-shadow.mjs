import { createEmptyCard, fsrs, Rating } from 'ts-fsrs'

const VERSION = 'ts-fsrs@5.2.3'
const MAX_HISTORY = 100

const RATING_NAMES = Object.freeze({
    [Rating.Again]: 'Again',
    [Rating.Hard]: 'Hard',
    [Rating.Good]: 'Good',
    [Rating.Easy]: 'Easy'
})

const ratingForOutcome = outcome => {
    // “认识” is a permanent product state, not FSRS Good. Easy keeps this
    // shadow signal explicitly separate from the formal scheduler.
    if (outcome === 'known') return Rating.Easy
    if (outcome === 'review-complete') return Rating.Good
    return Rating.Again
}

const asDate = (value, fallback) => {
    const date = value instanceof Date ? value : new Date(value || fallback)
    return Number.isNaN(date.getTime()) ? new Date(fallback) : date
}

const jsonClone = value => {
    if (value === undefined) return undefined
    return JSON.parse(JSON.stringify(value))
}

const toStoredCard = card => {
    const stored = {}
    for (const [key, value] of Object.entries(card || {})) {
        if (value === undefined) continue
        stored[key] = value instanceof Date ? value.toISOString() : value
    }
    return stored
}

const fromStoredCard = (stored, now) => {
    const base = createEmptyCard(now)
    if (!stored || typeof stored !== 'object') return base
    const card = { ...base, ...stored }
    card.due = asDate(stored.due, now)
    if (stored.last_review) card.last_review = asDate(stored.last_review, now)
    else delete card.last_review
    return card
}

function buildShadow(record, outcome, now = new Date()) {
    if (!record || typeof record !== 'object') return null
    const reviewAt = asDate(now, Date.now())
    const rating = ratingForOutcome(outcome)
    const scheduler = fsrs({ enable_fuzz: false })
    const previous = record.fsrsShadow?.card
    const card = fromStoredCard(previous, reviewAt)
    const result = scheduler.next(card, reviewAt, rating)
    const nextCard = result?.card || card
    const ratingName = RATING_NAMES[rating] || String(rating)
    const suggestedDue = asDate(nextCard.due, reviewAt).toISOString()
    const history = Array.isArray(record.reviewHistory) ? record.reviewHistory : []
    const nextHistory = [...history, {
        at: reviewAt.toISOString(),
        outcome: String(outcome || 'unknown'),
        rating: ratingName,
        suggestedDue,
        source: 'fsrs-shadow'
    }].slice(-MAX_HISTORY)

    return {
        ...record,
        fsrsShadow: {
            ...(record.fsrsShadow && typeof record.fsrsShadow === 'object' ? jsonClone(record.fsrsShadow) : {}),
            card: toStoredCard(nextCard),
            suggestedDue,
            rating: ratingName,
            updatedAt: reviewAt.toISOString()
        },
        reviewHistory: nextHistory
    }
}

export function applyFsrsShadow(record, outcome, now = new Date()) {
    return buildShadow(record, outcome, now)
}

export function ratingNameForOutcome(outcome) {
    return RATING_NAMES[ratingForOutcome(outcome)] || 'Again'
}

export const FSRS_SHADOW_VERSION = VERSION

globalThis.KangkangFsrsShadow = {
    FSRS_SHADOW_VERSION,
    applyFsrsShadow,
    ratingNameForOutcome
}
