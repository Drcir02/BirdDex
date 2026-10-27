import { test, type Page } from '@playwright/test'
import { downloadBrain, expect, openApp, readDatabase } from './scan-helpers'
import { mockWikimedia, seedDemo } from './dex-helpers'
import { collectErrors, skipWelcome } from './shell-helpers'

// The group in a real browser, with the pretend server (birddex:groupServer = fake): joining by an invitation link, the feed with
// its Super button, the leaderboards, the members, the round key with its red dot, sharing a new catch (and hiding it), leaving.
// Screenshots go to test-results/group-shots-<port>/ for the phone sizes.

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } })

const port = process.env.E2E_PORT ?? '4173'
const SHOTS = `test-results/group-shots-${port}`
const FAKE = { 'birddex:groupServer': 'fake', 'birddex:shareDelay': '400' }
const CODE = 'RODINA23'

const posts = (page: Page) => page.getByTestId('feed-post')

async function joinByLink(page: Page, nickname = 'Míša') {
  await openApp(page, `/group/join/${CODE}`, { storage: FAKE })
  await expect(page.getByTestId('code-input')).toHaveValue(CODE)
  await page.getByTestId('nickname-input').fill(nickname)
  await page.getByTestId('join-submit').click()
  await expect(page).toHaveURL(/#\/group$/)
  await expect(posts(page).first()).toBeVisible()
}

/** The pretend server keeps its state in localStorage: look into it, or let somebody else post. */
const fakeServer = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('birddex:fake-group-server') ?? 'null') as {
        posts: Array<{ userId: string; speciesId: string; catchId: string }>
      },
  )

test.describe('joining', () => {
  test('joins by an invitation link, and the feed, the leaderboard and the members are there', async ({ page }) => {
    const errors = collectErrors(page)
    await joinByLink(page)
    await expect(page.getByTestId('group-title-name')).toHaveText('Rodina')
    await expect(posts(page)).toHaveCount(9)
    await page.screenshot({ path: `${SHOTS}/feed-390.png` })

    await page.getByRole('radio', { name: 'Žebříček' }).click()
    await expect(page.getByTestId('podium')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/board-390.png` })
    await page.getByTestId('board-strongest').click()
    await expect(page.getByTestId('podium')).toContainText('BP 790')
    await page.getByRole('radio', { name: 'Členové' }).click()
    await expect(page.getByTestId('member-row')).toHaveCount(4)
    await page.getByTestId('member-row').first().getByRole('link').click()
    await expect(page.getByTestId('member-nick')).toHaveText('Tomáš')
    await expect(page.getByTestId('member-catches')).toHaveText('4')
    await page.screenshot({ path: `${SHOTS}/member-390.png` })
    expect(errors.filter((message) => !/429|Failed to load resource/.test(message))).toEqual([])
  })

  test('does not fit badly on the smallest phone: nothing sticks out sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await joinByLink(page, 'Pepa')
    for (const tab of ['Feed', 'Žebříček', 'Členové']) {
      await page.getByRole('radio', { name: tab }).click()
      await page.waitForTimeout(300)
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(sideways).toBe(0)
      await page.screenshot({ path: `${SHOTS}/${tab}-320.png` })
    }
    await page.goto('/#/settings')
    await expect(page.getByTestId('group-section')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    await page.screenshot({ path: `${SHOTS}/settings-320.png`, fullPage: true })
  })

  test('says what is wrong with a wrong code, and a name that is taken', async ({ page }) => {
    await openApp(page, '/group/join', { storage: FAKE })
    await page.getByTestId('code-input').fill('NOPE2345')
    await page.getByTestId('nickname-input').fill('Míša')
    await page.getByTestId('join-submit').click()
    await expect(page.getByTestId('join-error')).toContainText('Takovou skupinu neznám')
    await page.getByTestId('code-input').fill(CODE)
    await page.getByTestId('nickname-input').fill('Anna')
    await page.getByTestId('join-submit').click()
    await expect(page.getByTestId('join-error')).toContainText('přezdívku už')
  })

  test('makes a group with the founder code and shows the invitation with the QR code', async ({ page }) => {
    await openApp(page, '/group/create', { storage: FAKE })
    await page.getByTestId('founder-input').fill('TESTFOUNDER')
    await page.getByTestId('group-name-input').fill('Kamarádi')
    await page.getByTestId('nickname-input').fill('Já')
    await page.getByTestId('create-submit').click()
    await expect(page.getByTestId('invite-code')).toHaveText(/^[A-Z2-9]{8}$/)
    await page.getByTestId('invite-qr-toggle').click()
    await expect(page.getByTestId('invite-qr').locator('svg')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/invite-390.png` })
    await page.getByTestId('create-to-group').click()
    await expect(page.getByTestId('feed')).toBeVisible()
    await expect(page.getByTestId('feed-post')).toHaveCount(0)
    await expect(page.getByText('Ve feedu zatím nic není')).toBeVisible()
  })
})

test.describe('the birds from before joining', () => {
  test('count in the leaderboard (without a picture or a place), but the feed has only what is new', async ({ page }) => {
    await skipWelcome(page)
    await mockWikimedia(page)
    await seedDemo(page) // 30 birds, made before any group
    await page.goto('about:blank') // a whole new load, so that the pretend server setting of openApp is read
    await joinByLink(page)
    await expect(posts(page)).toHaveCount(9)
    // Everything the phone had is sent as "stats only" a moment after joining.
    await expect
      .poll(
        async () => {
          const server = await page.evaluate(
            () =>
              JSON.parse(localStorage.getItem('birddex:fake-group-server') ?? 'null') as {
                posts: Array<{ userId: string; inFeed?: boolean; mediaPath?: string; placeName?: string }>
              },
          )
          return server.posts.filter((post) => post.inFeed === false).length
        },
        { timeout: 20_000 },
      )
      .toBe(30)
    const server = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('birddex:fake-group-server') ?? 'null') as {
          posts: Array<{ inFeed?: boolean; mediaPath?: string; placeName?: string; lat?: number }>
        },
    )
    expect(server.posts.filter((post) => post.inFeed === false).every((post) => !post.mediaPath && !post.placeName && post.lat === undefined)).toBe(
      true,
    )

    await page.getByRole('radio', { name: 'Žebříček' }).click()
    await page.getByTestId('board-catches').click()
    const mine = page.locator('[data-testid=board-row], [data-testid=podium] li').filter({ hasText: 'Míša' })
    await expect(mine.first()).toContainText('30 úlovků')
    await page.screenshot({ path: `${SHOTS}/board-with-older-390.png` })
    // The feed still has only the nine posts of the others, nothing of mine.
    await page.getByRole('radio', { name: 'Feed' }).click()
    await expect(posts(page)).toHaveCount(9)
    await expect(page.getByTestId('feed').locator('[data-user-id]').filter({ hasText: 'Míša' })).toHaveCount(0)
  })
})

test.describe('the feed', () => {
  test('gives a Super and takes it back, and opens the details of a post', async ({ page }) => {
    await joinByLink(page)
    const hoopoe = page.locator('[data-testid=feed-post][data-species-id="upupa-epops"]')
    await expect(hoopoe.getByTestId('post-reactions')).toHaveText('2')
    await hoopoe.getByTestId('post-react').click()
    await expect(hoopoe.getByTestId('post-reactions')).toHaveText('3')
    await hoopoe.getByTestId('post-toggle').click()
    await expect(hoopoe.getByTestId('post-details')).toContainText('ještě nemáš v Dexu')
    await expect(hoopoe.getByTestId('post-map')).toHaveAttribute('href', /openstreetmap\.org\/\?mlat=48\.85550&mlon=16\.04880/)
    await page.reload()
    await expect(hoopoe.getByTestId('post-reactions')).toHaveText('3')
    await hoopoe.getByTestId('post-react').click()
    await expect(hoopoe.getByTestId('post-reactions')).toHaveText('2')
  })

  test('shows the red dot on the round key when somebody posted, and no dot after looking', async ({ page }) => {
    await joinByLink(page)
    // Looking at the feed makes the news old.
    await page.goto('/#/')
    await expect(page.getByTestId('nav-group')).toBeVisible()
    await expect(page.getByTestId('group-dot')).toHaveCount(0)
    // Somebody else posts while the app is closed.
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('birddex:fake-group-server') as string)
      raw.posts.push({
        id: 'fresh',
        groupId: raw.groups[0].id,
        userId: 'fake-anna',
        catchId: 'fresh',
        speciesId: 'pica-pica',
        method: 'live',
        confidence: 0.9,
        caughtAt: Date.now(),
        createdAt: Date.now() + 5000,
      })
      localStorage.setItem('birddex:fake-group-server', JSON.stringify(raw))
    })
    await page.reload()
    await expect(page.getByTestId('group-dot')).toBeVisible()
    await expect(page.getByTestId('nav-group')).toHaveAttribute('aria-label', 'Skupina, jsou tam nové úlovky')
    await page.getByTestId('nav-group').click()
    await expect(posts(page).first()).toHaveAttribute('data-species-id', 'pica-pica')
    await page.goto('/#/')
    await expect(page.getByTestId('group-dot')).toHaveCount(0)
  })
})

test.describe('sharing a catch', () => {
  async function catchOne(page: Page) {
    await openApp(page, '/scan/sound', { delay: 60, storage: FAKE })
    await downloadBrain(page)
    await page.getByTestId('sound-start').click()
    await expect(page.getByTestId('guess-name').first()).toHaveText('Sýkora koňadra')
    await page.getByTestId('sound-stop').click()
    await expect(page).toHaveURL(/#\/result$/)
    const first = page.getByTestId('result-card').first()
    await first.getByRole('button', { name: 'Chytit' }).click()
    await page.getByRole('alertdialog', { name: 'Přidat do Dexu?' }).getByRole('button', { name: 'Chytit' }).click()
    await expect(page.getByTestId('catch-success')).toBeVisible()
  }

  test('a catch made in a group is posted by itself with its BP, picture and place, and shows at the top of the feed', async ({ page }) => {
    // Join first (the same page keeps its storage), then catch.
    await joinByLink(page)
    await catchOne(page)
    const control = page.getByTestId('share-control')
    await expect(control).toBeVisible()
    await expect.poll(async () => control.getAttribute('data-share-state'), { timeout: 15_000 }).toBe('sent')
    await page.screenshot({ path: `${SHOTS}/share-390.png` })
    const bp = await page.getByTestId('bp-value').first().textContent()
    const saved = await readDatabase(page)
    expect(saved.catches[0]).toMatchObject({ shareState: 'sent' })

    await page.goto('/#/group')
    const mine = posts(page).first()
    await expect(mine).toHaveAttribute('data-species-id', 'parus-major')
    await expect(mine.getByTestId('post-author')).toContainText('Míša')
    await expect(mine.getByTestId('bp-value')).toHaveText(bp ?? '')
    await expect(mine.getByTestId('badge-first')).toHaveCount(0)
    await expect(mine.getByTestId('badge-new')).toBeVisible()
  })

  test('hiding the catch on the success screen keeps it out of the feed', async ({ page }) => {
    await joinByLink(page)
    await catchOne(page)
    await page.getByRole('switch', { name: /Sdílet se skupinou/ }).click()
    await expect(page.getByTestId('share-control')).toHaveAttribute('data-share-state', 'hidden')
    await page.waitForTimeout(1500)
    expect(
      (await fakeServer(page)).posts.filter((post) => post.userId !== 'fake-tomas' && post.userId !== 'fake-anna' && post.userId !== 'fake-jirka'),
    ).toHaveLength(0)
  })

  test('a catch made without a group is not shared and has no switches', async ({ page }) => {
    await openApp(page, '/scan/sound', { delay: 60, storage: FAKE })
    await downloadBrain(page)
    await page.getByTestId('sound-start').click()
    await expect(page.getByTestId('guess-name').first()).toHaveText('Sýkora koňadra')
    await page.getByTestId('sound-stop').click()
    await page.getByTestId('result-card').first().getByRole('button', { name: 'Chytit' }).click()
    await page.getByRole('alertdialog', { name: 'Přidat do Dexu?' }).getByRole('button', { name: 'Chytit' }).click()
    await expect(page.getByTestId('catch-success')).toBeVisible()
    await expect(page.getByTestId('share-control')).toHaveCount(0)
  })
})

test.describe('leaving', () => {
  test('leaves the group from the settings after a question, and the join buttons come back', async ({ page }) => {
    await joinByLink(page)
    await page.goto('/#/settings')
    await expect(page.getByTestId('group-name')).toHaveText('Rodina')
    await page.getByTestId('group-leave').click()
    await expect(page.getByRole('alertdialog')).toContainText('Všechny tvoje příspěvky')
    await page.getByRole('button', { name: 'Odejít a smazat příspěvky' }).click()
    await expect(page.getByTestId('group-join-link')).toBeVisible()
    await page.goto('/#/group')
    await expect(page.getByRole('heading', { name: 'Zatím v žádné skupině nejsi' })).toBeVisible()
  })

  test('says that nothing is sent before joining (About page)', async ({ page }) => {
    await openApp(page, '/about', { storage: FAKE })
    await expect(page.getByTestId('about-privacy-group')).toContainText('Když se sám přidáš do skupiny')
  })
})
