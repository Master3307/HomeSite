import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'

const INPUT_DIR = 'src/assets/fullsize/img'
const OUTPUT_DIR = 'public/img'

const SIZES = [
  { suffix: 'sm', width: 320 },
  { suffix: 'md', width: 640 },
  { suffix: 'lg', width: 1024 },
]

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif'])
const GIF_EXTS = new Set(['.gif'])

function walk(dir) {
  const results = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      results.push(...walk(fullPath))
    } else {
      results.push(fullPath)
    }
  }

  return results
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

const files = walk(INPUT_DIR)

for (const inputPath of files) {
  const relPath = path.relative(INPUT_DIR, inputPath)
  const ext = path.extname(inputPath).toLowerCase()
  const parsed = path.parse(relPath)

  if (IMAGE_EXTS.has(ext)) {
    for (const size of SIZES) {
      const outWebp = path.join(
        OUTPUT_DIR,
        parsed.dir,
        `${parsed.name}-${size.suffix}.webp`
      )

      const outJpg = path.join(
        OUTPUT_DIR,
        parsed.dir,
        `${parsed.name}-${size.suffix}.jpg`
      )

      ensureDir(outWebp)
      ensureDir(outJpg)

      await sharp(inputPath)
        .resize({ width: size.width })
        .webp({ quality: 80 })
        .toFile(outWebp)

      await sharp(inputPath)
        .resize({ width: size.width })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(outJpg)
    }
  } else if (GIF_EXTS.has(ext)) {
    const outGif = path.join(OUTPUT_DIR, relPath)
    ensureDir(outGif)
    fs.copyFileSync(inputPath, outGif)
  }
}