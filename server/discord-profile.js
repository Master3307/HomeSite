import 'dotenv/config'
import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const DISCORD_USER_ID = process.env.DISCORD_USER_ID
const PORT = process.env.PORT || 3001

if (!DISCORD_BOT_TOKEN) {
  throw new Error('Missing DISCORD_BOT_TOKEN')
}

if (!DISCORD_USER_ID) {
  throw new Error('Missing DISCORD_USER_ID')
}

const DISCORD_API = 'https://discord.com/api/v10'
const CDN = 'https://cdn.discordapp.com'

const USER_FLAGS = {
  STAFF: 1 << 0,
  PARTNER: 1 << 1,
  HYPESQUAD: 1 << 2,
  BUG_HUNTER_LEVEL_1: 1 << 3,
  HYPESQUAD_ONLINE_HOUSE_1: 1 << 6,
  HYPESQUAD_ONLINE_HOUSE_2: 1 << 7,
  HYPESQUAD_ONLINE_HOUSE_3: 1 << 8,
  PREMIUM_EARLY_SUPPORTER: 1 << 9,
  BUG_HUNTER_LEVEL_2: 1 << 14,
  VERIFIED_BOT: 1 << 16,
  VERIFIED_DEVELOPER: 1 << 17,
  CERTIFIED_MODERATOR: 1 << 18,
  ACTIVE_DEVELOPER: 1 << 22,
}

function hasFlag(bits = 0, flag) {
  return (bits & flag) === flag
}

function mapBadges(publicFlags = 0) {
  const badges = []

  if (hasFlag(publicFlags, USER_FLAGS.STAFF)) badges.push({ key: 'staff', label: 'Discord Staff' })
  if (hasFlag(publicFlags, USER_FLAGS.PARTNER)) badges.push({ key: 'partner', label: 'Partnered Server Owner' })
  if (hasFlag(publicFlags, USER_FLAGS.HYPESQUAD)) badges.push({ key: 'hypesquad', label: 'HypeSquad Events' })
  if (hasFlag(publicFlags, USER_FLAGS.BUG_HUNTER_LEVEL_1)) badges.push({ key: 'bug-hunter-1', label: 'Bug Hunter Lv1' })
  if (hasFlag(publicFlags, USER_FLAGS.HYPESQUAD_ONLINE_HOUSE_1)) badges.push({ key: 'bravery', label: 'House Bravery' })
  if (hasFlag(publicFlags, USER_FLAGS.HYPESQUAD_ONLINE_HOUSE_2)) badges.push({ key: 'brilliance', label: 'House Brilliance' })
  if (hasFlag(publicFlags, USER_FLAGS.HYPESQUAD_ONLINE_HOUSE_3)) badges.push({ key: 'balance', label: 'House Balance' })
  if (hasFlag(publicFlags, USER_FLAGS.PREMIUM_EARLY_SUPPORTER)) badges.push({ key: 'early-supporter', label: 'Early Supporter' })
  if (hasFlag(publicFlags, USER_FLAGS.BUG_HUNTER_LEVEL_2)) badges.push({ key: 'bug-hunter-2', label: 'Bug Hunter Lv2' })
  if (hasFlag(publicFlags, USER_FLAGS.VERIFIED_DEVELOPER)) badges.push({ key: 'verified-developer', label: 'Early Verified Bot Developer' })
  if (hasFlag(publicFlags, USER_FLAGS.CERTIFIED_MODERATOR)) badges.push({ key: 'moderator', label: 'Moderator Programs Alumni' })
  if (hasFlag(publicFlags, USER_FLAGS.ACTIVE_DEVELOPER)) badges.push({ key: 'active-developer', label: 'Active Developer' })

  return badges
}

function avatarUrl(user) {
  if (!user.avatar) {
    const index = Number(user.discriminator || 0) % 5
    return `${CDN}/embed/avatars/${index}.png`
  }

  const isGif = user.avatar.startsWith('a_')
  return `${CDN}/avatars/${user.id}/${user.avatar}.${isGif ? 'gif' : 'webp'}?size=256`
}

function bannerUrl(user) {
  if (!user.banner) return null
  const isGif = user.banner.startsWith('a_')
  return `${CDN}/banners/${user.id}/${user.banner}.${isGif ? 'gif' : 'webp'}?size=512`
}

function avatarDecorationUrl(user) {
  const asset = user.avatar_decoration_data?.asset
  if (!asset) return null
  return `${CDN}/avatar-decoration-presets/${asset}.png`
}

function guildBadgeUrl(user) {
  const guildId = user.primary_guild?.identity_guild_id
  const badge = user.primary_guild?.badge
  if (!guildId || !badge) return null
  return `${CDN}/guild-tag-badges/${guildId}/${badge}.png`
}

app.get('/api/discord-profile/avatar', async (_req, res) => {
  try {
    const response = await fetch(`${DISCORD_API}/users/${DISCORD_USER_ID}`, {
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      },
    })

    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch Discord user')
    }

    const user = await response.json()

    if (!user.avatar) {
      return res.status(404).send('No avatar')
    }

    const isGif = user.avatar.startsWith('a_')
    const url = `${CDN}/avatars/${user.id}/${user.avatar}.${isGif ? 'gif' : 'png'}?size=256`

    const imageRes = await fetch(url)
    if (!imageRes.ok) {
      return res.status(imageRes.status).send('Failed to fetch avatar image')
    }

    res.setHeader('Content-Type', imageRes.headers.get('content-type') || 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=300')

    const arrayBuffer = await imageRes.arrayBuffer()
    res.send(Buffer.from(arrayBuffer))
  } catch (error) {
    res.status(500).send(error instanceof Error ? error.message : 'Avatar proxy failed')
  }
})

app.listen(PORT, () => {
  console.log(`discord profile api listening on http://localhost:${PORT}`)
})