// Checks the group server against the real Supabase project: who may read and write what, the functions, the leaderboards.
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_KEY=<publishable or anon key> FOUNDER_CODE=XXXXX-XXXXX node scripts/group-smoke-test.mjs
// (on a machine behind a proxy: NODE_USE_ENV_PROXY=1). It makes its own test group and members and removes the group at the end;
// the anonymous test users it makes stay in the project's user list, which is harmless.
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL: url, SUPABASE_KEY: key, FOUNDER_CODE: founder } = process.env
if (!url || !key || !founder) {
  console.error('set SUPABASE_URL, SUPABASE_KEY and FOUNDER_CODE')
  process.exit(2)
}

let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
}
const errorOf = (result) => result.error?.message ?? result.error?.code ?? ''

async function person(label) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signInAnonymously()
  if (error) throw new Error(`${label}: anonymous sign-in failed: ${error.message}`)
  return { client, id: data.user.id, label }
}

const [a, b, c] = [await person('A'), await person('B'), await person('C')]
const post = (who, group, catchId, species, patch = {}) =>
  who.client.from('posts').insert({
    group_id: group, user_id: who.id, catch_id: catchId, species_id: species, method: 'live', confidence: 0.9,
    bp: 400, bp_base: 380, bp_range: [50, 750], bp_factors: [0.8, 1, 1, 1, 1], caught_at: new Date().toISOString(),
    place_name: 'Praha', lat: 50.08, lon: 14.43, ...patch,
  }).select().single()

// ----- making a group
let r = await a.client.rpc('create_group', { p_secret: 'WRONG-CODE', p_name: 'Test', p_nickname: 'Anna', p_color: '#ff0000' })
check('a wrong founder code does not make a group', !!r.error && r.error.code === '28P01', errorOf(r))
r = await a.client.rpc('create_group', { p_secret: founder.toLowerCase(), p_name: 'Smoke test', p_nickname: 'Anna', p_color: '#ff0000' })
check('the founder code makes a group (also in lower case)', !r.error && r.data?.[0]?.code?.length === 8, errorOf(r))
const group = r.data?.[0]?.group_id
const code = r.data?.[0]?.code

// ----- joining
r = await b.client.rpc('join_group', { p_code: 'NOSUCHGR', p_nickname: 'Bob', p_color: '#00ff00' })
check('a wrong invite code is refused', !!r.error && r.error.code === 'P0002', errorOf(r))
r = await b.client.rpc('join_group', { p_code: `${code.slice(0, 4)}-${code.slice(4).toLowerCase()}`, p_nickname: 'Bob', p_color: '#00ff00' })
check('the invite code works with a dash and in lower case', !r.error && r.data?.[0]?.group_id === group, errorOf(r))
r = await c.client.rpc('join_group', { p_code: code, p_nickname: 'anna', p_color: '#0000ff' })
check('a nickname that is taken (any case) is refused', !!r.error && r.error.code === '23505', errorOf(r))

// ----- a stranger sees nothing
for (const table of ['groups', 'members', 'posts', 'reactions']) {
  r = await c.client.from(table).select('*')
  check(`a stranger reads no ${table}`, !r.error && r.data.length === 0, errorOf(r) || JSON.stringify(r.data).slice(0, 80))
}
r = await c.client.rpc('group_feed', { p_group: group })
check('a stranger gets an empty feed', !r.error && r.data.length === 0, errorOf(r))
r = await c.client.rpc('group_leaderboard', { p_group: group, p_board: 'species' })
check('a stranger gets no leaderboard', !!r.error, 'it answered')
r = await c.client.from('groups').insert({ name: 'mine', code: 'AAAAAAAA', created_by: c.id })
check('nobody makes a group by writing to the table', !!r.error, 'it worked')
r = await c.client.from('members').insert({ group_id: group, user_id: c.id, nickname: 'Carl' })
check('nobody joins by writing to the table', !!r.error, 'it worked')

// ----- posting
const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })
const pathA = `${group}/${a.id}/catch-a1.jpg`
r = await a.client.storage.from('posts').upload(pathA, jpeg, { contentType: 'image/jpeg' })
check('a member uploads a picture into their own folder', !r.error, errorOf(r))
r = await b.client.storage.from('posts').upload(`${group}/${a.id}/catch-fake.jpg`, jpeg, { contentType: 'image/jpeg' })
check('a member cannot upload into the folder of somebody else', !!r.error, 'it worked')
r = await c.client.storage.from('posts').upload(`${group}/${c.id}/catch-c.jpg`, jpeg, { contentType: 'image/jpeg' })
check('a stranger cannot upload into the group', !!r.error, 'it worked')
r = await a.client.storage.from('posts').upload(`${group}/${a.id}/big.txt`, new Blob(['hi'], { type: 'text/plain' }), { contentType: 'text/plain' })
check('only pictures and clips are accepted', !!r.error, 'it worked')

r = await post(a, group, 'catch-a1', 'parus-major', { media_path: pathA, media_kind: 'image' })
check('a member posts a catch', !r.error, errorOf(r))
const postA1 = r.data?.id
r = await post(b, group, 'catch-b1', 'parus-major')
check('a second member posts the same species', !r.error, errorOf(r))
const postB1 = r.data?.id
r = await post(a, group, 'catch-a2', 'parus-major')
check('a member posts the same species again', !r.error, errorOf(r))
r = await post(a, group, 'catch-a1', 'parus-major')
check('the same catch cannot be posted twice', !!r.error, 'it worked')
r = await post(b, group, 'catch-fake', 'turdus-merula', { user_id: a.id })
check('a member cannot post in the name of somebody else', !!r.error, 'it worked')
r = await post(c, group, 'catch-c1', 'parus-major')
check('a stranger cannot post', !!r.error, 'it worked')
r = await post(a, group, 'catch-bad1', 'parus-major', { bp: 900 })
check('a BP outside the range of the bird is refused', !!r.error, 'it worked')
r = await post(a, group, 'catch-bad2', 'parus-major', { caught_at: new Date(Date.now() + 3 * 86_400_000).toISOString() })
check('a catch dated in the future is refused', !!r.error, 'it worked')
r = await post(a, group, 'catch-bad3', 'Parus Major!')
check('a malformed species id is refused', !!r.error, 'it worked')

// ----- reading
r = await b.client.rpc('group_feed', { p_group: group })
check('a member reads the feed, newest first', !r.error && r.data.length === 3 && r.data[0].catch_id === 'catch-a2', errorOf(r))
const byCatch = Object.fromEntries((r.data ?? []).map((row) => [row.catch_id, row]))
check('the feed has the nickname and the colour', byCatch['catch-a1']?.nickname === 'Anna' && byCatch['catch-a1']?.color === '#ff0000')
check('the first post of a species is new for its author and first in the group', byCatch['catch-a1']?.new_for_user === true && byCatch['catch-a1']?.first_in_group === true)
check('the same species by another member is new for them, not first in the group', byCatch['catch-b1']?.new_for_user === true && byCatch['catch-b1']?.first_in_group === false)
check('a repeat is neither', byCatch['catch-a2']?.new_for_user === false && byCatch['catch-a2']?.first_in_group === false)
r = await b.client.rpc('group_feed', { p_group: group, p_new_only: true })
check('the "new species only" filter keeps two', !r.error && r.data.length === 2, errorOf(r))
r = await b.client.rpc('group_feed', { p_group: group, p_user: b.id })
check('the "only mine" filter keeps one', !r.error && r.data.length === 1, errorOf(r))
r = await b.client.rpc('group_feed', { p_group: group, p_limit: 1, p_before: byCatch['catch-a2']?.created_at })
check('paging goes on from the last post', !r.error && r.data.length === 1 && r.data[0].catch_id === 'catch-b1', errorOf(r))
r = await b.client.storage.from('posts').download(pathA)
check('a member downloads the picture of another member', !r.error && r.data?.size === 4, errorOf(r))
r = await c.client.storage.from('posts').download(pathA)
check('a stranger cannot download it', !!r.error, 'it worked')
r = await b.client.storage.from('posts').createSignedUrl(pathA, 60)
check('a member gets a signed address of it', !r.error && !!r.data?.signedUrl, errorOf(r))
r = await c.client.storage.from('posts').createSignedUrl(pathA, 60)
check('a stranger gets no signed address', !!r.error, 'it worked')

// ----- reactions
r = await b.client.from('reactions').insert({ post_id: postA1, user_id: b.id })
check('a member reacts', !r.error, errorOf(r))
r = await b.client.from('reactions').insert({ post_id: postA1, user_id: b.id })
check('a second reaction of the same member is refused', !!r.error, 'it worked')
r = await c.client.from('reactions').insert({ post_id: postA1, user_id: c.id })
check('a stranger cannot react', !!r.error, 'it worked')
r = await a.client.rpc('group_feed', { p_group: group, p_user: a.id })
const reacted = (r.data ?? []).find((row) => row.catch_id === 'catch-a1')
check('the feed counts the reaction', reacted?.reactions === 1 && reacted?.i_reacted === false, JSON.stringify(reacted))
r = await b.client.rpc('group_feed', { p_group: group, p_user: a.id })
check('and knows who reacted', (r.data ?? []).find((row) => row.catch_id === 'catch-a1')?.i_reacted === true)
r = await b.client.from('reactions').delete().eq('post_id', postA1)
r = await a.client.rpc('group_feed', { p_group: group, p_user: a.id })
check('a reaction is taken back', (r.data ?? []).find((row) => row.catch_id === 'catch-a1')?.reactions === 0)

// ----- leaderboards
const board = async (name) => (await b.client.rpc('group_leaderboard', { p_group: group, p_board: name })).data ?? []
let rows = await board('species')
check('Druhy: Anna 1 species, Bob 1', rows.length === 2 && rows.every((row) => row.value === 1), JSON.stringify(rows))
rows = await board('catches')
check('Úlovky: Anna 2, Bob 1', rows[0]?.nickname === 'Anna' && rows[0]?.value === 2 && rows[1]?.value === 1, JSON.stringify(rows))
await post(b, group, 'catch-b2', 'erithacus-rubecula', { bp: 700 })
rows = await board('strongest')
check('Nejsilnější: Bob 700 with the robin first', rows[0]?.nickname === 'Bob' && rows[0]?.value === 700 && rows[0]?.species_id === 'erithacus-rubecula', JSON.stringify(rows))
await post(b, group, 'catch-b3', 'turdus-merula', { caught_at: new Date(Date.now() - 86_400_000).toISOString() })
rows = await board('streak')
check('Série: Bob has a two-day run, Anna one day', rows[0]?.nickname === 'Bob' && rows[0]?.value === 2 && rows[1]?.value === 1, JSON.stringify(rows))
r = await b.client.rpc('group_leaderboard', { p_group: group, p_board: 'species', p_since: new Date(Date.now() + 3_600_000).toISOString() })
check('a period in the future leaves everybody at 0', !r.error && r.data.every((row) => row.value === 0), errorOf(r))
r = await b.client.rpc('group_leaderboard', { p_group: group, p_board: 'nonsense' })
check('an unknown board is refused', !!r.error, 'it answered')

// ----- who can change what
r = await b.client.from('members').update({ nickname: 'Bobík' }).eq('group_id', group).eq('user_id', b.id).select()
check('a member renames themselves', !r.error && r.data?.[0]?.nickname === 'Bobík', errorOf(r))
r = await b.client.from('members').update({ is_admin: true }).eq('group_id', group).eq('user_id', b.id).select()
check('a member cannot make themselves admin', !!r.error, 'it worked')
r = await b.client.from('members').update({ nickname: 'Hacked' }).eq('group_id', group).eq('user_id', a.id).select()
check('a member cannot rename somebody else', !r.error && (r.data ?? []).length === 0, errorOf(r))
r = await b.client.from('posts').delete().eq('id', postA1).select()
check('a member cannot delete the post of somebody else', (r.data ?? []).length === 0, errorOf(r))
r = await b.client.rpc('remove_member', { p_group: group, p_user: a.id })
check('a member cannot remove another member', !!r.error, 'it worked')
r = await b.client.storage.from('posts').remove([pathA])
check('a member cannot delete the file of somebody else', (r.data ?? []).length === 0, errorOf(r))
r = await a.client.from('posts').delete().eq('id', postB1).select()
check('the admin deletes a post of a member', !r.error && r.data?.length === 1, errorOf(r))

// ----- leaving and clearing up
r = await b.client.rpc('leave_group', { p_group: group })
check('a member leaves, and their posts go with them', !r.error, errorOf(r))
r = await a.client.rpc('group_feed', { p_group: group })
check('only the posts of the one who stayed are left', !r.error && r.data.every((row) => row.user_id === a.id), errorOf(r))
r = await a.client.storage.from('posts').remove([pathA])
check('the admin removes a file', !r.error, errorOf(r))
r = await a.client.rpc('leave_group', { p_group: group })
check('the last member leaves and the group is closed', !r.error, errorOf(r))
r = await a.client.from('groups').select('id').eq('id', group)
check('the group is gone', !r.error && r.data.length === 0, errorOf(r))

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
