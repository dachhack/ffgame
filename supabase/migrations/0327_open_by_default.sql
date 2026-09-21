-- 0327: THE PUBLIC API IS OPEN BY DEFAULT — with an opt-out.
--
-- 0326 shipped the read API opt-in: a league was private until its
-- commissioner published it. Founder: "let's actually do the opposite. Open
-- by default with an opt out." That is the Sleeper bargain, and it is the
-- whole reason the gap list put this row on the board — an ecosystem does not
-- grow on the leagues whose commissioners went looking for a switch. A tool
-- author can only build against what is reliably there.
--
-- WHAT CHANGES: the meaning of the ABSENCE of settings_json.public_api. It
-- used to mean "off, unless this is a pod"; it now means "on, if this league
-- lives here". An explicit false is untouched and still honoured — somebody
-- who turned it off did so on purpose, and a default flip must never quietly
-- re-publish a league that opted out.
--
-- WHAT DOES NOT CHANGE, and is what makes open-by-default defensible:
--   · THE NEVER-LIST. Sealed picks before they reveal, pending waiver bids,
--     trade offers in flight, emails, invite codes, chat — none of it was
--     served when this was opt-in and none of it is served now. Flipping a
--     default cannot leak what no endpoint returns.
--   · NO DIRECTORY. There is no "list the public leagues" endpoint and never
--     will be. A league is readable only by whoever holds its id, which is a
--     v4 UUID — unguessable, and shared exactly as far as its members share
--     it. Open by default means "if you have the link"; it does not mean
--     indexed, enumerable or searchable.
--   · THE OPT-OUT IS ONE TAP, in the same place the opt-in was, and takes
--     effect on the next request.
--
-- IMPORTS STAY OPT-IN. A league imported from Sleeper, ESPN or Yahoo is a
-- mirror of somebody else's system, pulled in with that manager's own
-- credentials. Publishing OUR leagues by default is a product decision we get
-- to make; republishing a private ESPN league because somebody connected it
-- to us is not. Those stay off until a commissioner says otherwise.

create or replace function league_public_api(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(
      -- An explicit choice always wins, in either direction.
      (settings_json ->> 'public_api')::boolean,
      -- Absent: a league that lives here is open; an import is not.
      provider = 'native')
    from league where id = p_league_id and not coalesce(is_mock, false);
$$;
grant execute on function league_public_api(uuid) to authenticated;

-- api_health's own count reads the same rule, so "how many leagues are
-- readable" cannot drift from what is actually readable.
create or replace function api_health() returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'api', 'drip-public', 'version', 'v1',
    'public_leagues', (select count(*)::int from league l
                        where coalesce((l.settings_json ->> 'public_api')::boolean, l.provider = 'native')
                          and not coalesce(l.is_mock, false)),
    'now', now());
$$;
revoke all on function api_health() from public, anon;
grant execute on function api_health() to service_role, authenticated;
