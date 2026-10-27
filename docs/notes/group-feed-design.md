# Group feed and leaderboard: design proposal

**Status: agreed in the main points, nothing of it is in the app yet.** See "Decided" at the end.

## The short answer

Yes, it is possible, but it is the first thing in BirdDex that needs a **server**. Today everything stays in the phone and the app
is a static page on GitHub Pages, so two phones cannot see each other. A feed and a leaderboard need one shared place where every
phone puts its catches and reads the others'. That place has to be built outside the app (a small online database), and the
app has to say clearly that joining the group means sharing.

## What the server is

Recommended: **Supabase** (a hosted PostgreSQL database with file storage, realtime updates and anonymous sign-in).

| Why | Why not the others |
|---|---|
| The free plan has a 500 MB database and 1 GB of file storage, no card needed, and a leaderboard is one SQL query. | **Firebase** needs the paid Blaze plan (a card) for photo storage since 2026, and its database cannot add up a leaderboard by itself. |
| It speaks plain HTTPS from the browser, so it works from GitHub Pages. | Sharing files by hand (backup zips) is not a feed. |

Things to know about the free plan: a project is **paused after one week with no use** (the data stays, but somebody must press
Restore in the dashboard; a scheduled ping from GitHub Actions every few days prevents it), and the limits above are what the
sources say today (supabase.com/pricing is the place to confirm). A group of 5 to 30 people that shares photos of about 100 KB
fits: 30 people x 100 catches x 100 KB = 300 MB.

### Setting up the server (once for the whole app, not once per group)

A web page cannot create its own database, so one person has to open an account once. After that **everything about a group is
done inside the app** (a "Vytvořit skupinu" button, an invite QR code, the members); nobody else ever sees the website.

Two ways, the same result:

* **I do it (about 2 minutes of your time).** You sign up at supabase.com (the "Continue with GitHub" button, no card), make an
  access token (Account > Access Tokens, short expiry) and give it to me. With it I create the project in the EU (Frankfurt), apply
  the SQL file, switch on anonymous sign-in, put the public address and key into the app and test against it. Then you delete the
  token. The token can do anything in your Supabase account, so it is used only for this and revoked right after.
* **You do it (about 10 minutes).** Sign up, press New project (EU region), open SQL Editor and paste the file I give you, switch on
  Authentication > Providers > Anonymous sign-ins, then send me the Project URL and the anon key (the key is made to be public).

Then a scheduled GitHub Action pings the project every few days so that the free plan never pauses it.

## Who is who (no accounts, no passwords)

* **A group** has a name and an invite code. The person who makes it is its admin.
* **A phone joins** with the code (a link or a QR code: `#/join/CODE`), chooses a **nickname** and a colour, and agrees to what is
  shared. It gets an anonymous identity from the server; nobody types an e-mail or a password.
* The identity and the group are saved in the backup file, so a restored phone is the same member. A phone that lost everything
  can join again under a new nickname; the admin can remove the old one.
* The admin can remove a member or a post. Everybody can delete their own posts and leave the group (their posts go with them).

## What is shared, and what is not

A **post** is one catch of one member: nickname, bird (name, rarity), BP and its five scores, way of catching, date and time,
**place** (see below), and a **picture** (the photo, resized to 720 px, about 80 KB) or **recording** (the clip, a few seconds).
The original photo and the rest of the database never leave the phone. Only new catches are shared (nothing made before joining).

Settings (a new "Skupina" section in the settings):

* Share new catches automatically: on by default after joining, so the leaderboard is complete. Each catch can be unshared on the
  success screen and on its page.
* Place: **exact** (default: the name, and a tap on it opens the point on OpenStreetMap as on your own birds), **name only**
  (no map link), or **nothing**. A catch made at home can be hidden on its own on the success screen.
* Leave the group, and delete all my posts.

A catch that is not shared does not count in the leaderboard.

## Where it lives in the app

The bottom bar stays at three keys. A second **round key next to the settings gear** at the top right opens **Skupina** (a people
icon). A small red dot on it means new catches since the last visit, like a notification on Instagram. Inside, a switch has three
parts: **Feed**, **Žebříček** (leaderboard) and **Členové** (members).

```
 top of the device                      Skupina
 +--------------------------------+     +-----------------------------------+
 | (lens) (led)      BIRDDEX      |     | <  Skupina: Rodina        [Feed|Žebříček|Členové]
 |                 (people*)(gear)|     +-----------------------------------+
 +--------------------------------+          * = red dot when there is news
```

### Feed

A vertical list of cards, newest first, like Instagram. Pull down or tap the arrow to refresh; it also refreshes by itself every
minute while open, and new posts slide in. Twenty at a time, more when you scroll. Offline it shows what it saw last.

```
 +-----------------------------------+
 | (T) Tomáš            před 2 hodinami
 |     Praha, Stromovka              |
 | +-------------------------------+ |
 | |        photo (or the          | |
 | |   reference photo + player)   | |
 | +-------------------------------+ |
 | Zedníček skalní   ★★★★★  BP 1878  |
 | 50 --------------o------- 2200    |
 | [Nový druh pro Tomáše]  [První ve skupině!]
 | (live camera)         (bird) 3    |
 +-----------------------------------+
```

* The head: coloured avatar with the initial, nickname, how long ago, place.
* The picture: a photo, or for a sound catch the reference photo with the player of the clip.
* The bird: Czech name, rarity stars, **BP** with the bar between the least and the most BP of the species, the way of catching.
* Badges computed on the server: "new species for Tomáš" (his first of the species), "first in the group" (nobody had it).
* One reaction button (a bird, "super"): tap to give, a count under it. Comments are not in the first version.
* Tap the card: the post opens like your own bird's page, read-only, with the five scores, and a line "You have this species" or
  "Not in your Dex yet" that links to the species page.
* Filters at the top: Všichni, Jen nové druhy, Jen moje.

### Leaderboard

```
 [Celkem | Měsíc | Týden]      [Druhy | Nejsilnější | Úlovky | Série]
   1  (T) Tomáš        41 druhů   <- podium with the first three
   2  (A) Anna         38
   3  (J) Jirka        33
   4  (M) Míša         21
  ...
  12  (Ty) Ty          18         <- your row is always shown, highlighted
```

Boards (a switch):

| Board | Counts |
|---|---|
| **Druhy** (default) | different species caught: the progress of the Dex |
| **Nejsilnější pták** | the highest BP of a single bird |
| **Úlovky** | how many birds were caught |
| **Série** | the longest run of days with a catch |

Periods: all time, this month, this week (by the date of the catch). A tie shares the place. Tap a row to open that member.

### Member

The profile of a member: avatar, nickname, "41 druhů z 282", the rarest bird, the five strongest birds as a small grid with their
BP, and the latest catches. Nothing private.

### Joining

```
 Settings > Skupina > Připojit se        1. code or QR         2. what is shared       3. nickname + colour
```

The screen before joining says in plain Czech what is shared, who can see it (only members of this group), and that the app works
fully without it. The About page and the welcome tour now say "no server, nothing leaves the phone": they get an honest second
sentence ("unless you join a group").

## How it is built (for the record)

* **Server tables:** `groups`, `members` (user, group, nickname, colour, admin flag), `posts` (one per catch id, with the fields
  above and the path of the picture), `reactions`. Row-level security: only members of a group read its rows, a member writes only
  their own, the admin deletes. Pictures in a private storage bucket under the group and the member.
* **Leaderboards and badges:** database views and one function per board, so the phone only asks "the Druhy board for this month".
* **In the app:** `src/features/group/`, a thin interface (`join`, `publish`, `feed`, `board`, `react`, `leave`) with the Supabase
  client behind it, loaded only when a group is joined (the app stays small and offline-first for everybody else). A fake behind
  the same interface is used in all tests.
* **Uploading:** every shared catch goes into an outbox in the phone's database and is sent when there is a connection, with the
  catch id as the key, so a retry or a double tap never posts twice. A failed upload never blocks or loses a catch.
* **Changes in existing code:** the success screen (a share switch), the bird page (shared or not), settings (the Skupina
  section), the top bar (the new key), the backup file (the group identity), the database (one new table), the privacy texts.

## Honest limits

* **Cheating is possible.** The BP is computed on the phone, so somebody who edits the app can post any number. In a group of
  friends this is a matter of trust; the server only rejects impossible values (BP above the range of the species, a date in the
  future), and the admin can delete a post.
* **It needs internet** for the feed, the leaderboard and uploading. Catching and everything else still work offline.
* **The server belongs to whoever creates the project:** the group's data lives in their free Supabase account, and the admin sees
  everything in it. For friends and family that is fine; it must be said in the join screen.
* **Free plan pause** (above): a ping from GitHub Actions or somebody opening the app every week avoids it.
* **Photos of people:** a catch photo may have a person in it, and that is shown to the group. The photo is already redrawn on a
  canvas when it is saved, which drops the location and the camera data, and the shared copy is made from that one.

## Order of work

1. The server file (SQL) and the join flow, the sharing settings, the outbox and publishing, a feed that only reads.
2. The leaderboard and the member pages.
3. Reactions (decided: in the first version, so they come with part 1 or 2), the red dot.

About the size of the BirdPoints work, 1.5 to 2 times; the first two parts are what makes it useful.

## Decided

1. Entry: the **round key next to the gear**.
2. Catches are **shared automatically** after joining (each can be hidden on the success screen).
3. Place: **exact by default**, with a map link; name only or nothing are choices in the settings, and one catch can be hidden.
4. Leaderboards: **Druhy, Nejsilnější pták, Úlovky, Série**. No sum of BP.
5. **Reactions are in the first version** (comments later).
6. **Only new catches** are shared; no button for the older ones.

Still open: who makes the Supabase account, and which of the two ways above.
