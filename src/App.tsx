import React from "react";
import Layout from "./HUD/Layout/Layout";
import api, { port, isDev } from "./api/api";
import ActionManager, { ConfigManager } from "./api/actionManager";
import { Dota2, DOTA2GSI, PlayerExtension, TeamExtension } from "dotagsi";
import io from "socket.io-client";
import { loadAvatarURL } from "./api/avatars";
import { Match } from "./api/interfaces";
import "./HUD/GameHUD/gamehud.scss";
//import { exampleData } from './example';
import { initiateConnection } from "./HUD/Camera/mediaStream";
import { GameSummary } from "./summaries";

const DOTA2 = new DOTA2GSI();
export const socket = io(isDev ? `http://localhost:${port}` : "/", {
  transports: ["polling"],
});

let latestRawPayload: any = null;
let knownTeams: Partial<Record<"radiant" | "dire", TeamExtension>> = {};
/*
if (isTest) {
	setTimeout(() => {
		DOTA2.digest(exampleData);
	}, 100);
	setTimeout(() => {
		DOTA2.digest(exampleData)
	}, 2000)
}*/
let i = 0;
const sanitizeDigestPayload = (payload: any) => {
  const source = payload || {};
  return {
    ...source,
    provider: {
      name: "",
      ...(source.provider || {}),
    },
    map: {
      name: "",
      game_state: "",
      win_team: "none",
      ...(source.map || {}),
    },
    draft: {
      team2: {},
      team3: {},
      ...(source.draft || {}),
    },
    player: {
      team2: {},
      team3: {},
      ...(source.player || {}),
    },
    hero: {
      team2: {},
      team3: {},
      ...(source.hero || {}),
    },
    abilities: {
      team2: {},
      team3: {},
      ...(source.abilities || {}),
    },
    items: {
      team2: {},
      team3: {},
      ...(source.items || {}),
    },
  };
};

const isDotaParsedSnapshot = (payload: any) =>
  Boolean(
    payload &&
      typeof payload === "object" &&
      Array.isArray(payload.players) &&
      payload.draft &&
      (payload.draft.radiant || payload.draft.dire)
  );

const getLeagueTeam = (rawGsiData: any, side: "radiant" | "dire") => {
  const leagueTeam = rawGsiData?.league?.[side];
  const currentTeam = rawGsiData?.map?.[side];
  const name = String(leagueTeam?.name || "").trim();

  if (!name) return null;

  return {
    id: String(leagueTeam.team_id || currentTeam?.id || ""),
    name,
    short_name: String(leagueTeam.team_tag || currentTeam?.short_name || ""),
    country: currentTeam?.country ?? null,
    logo: currentTeam?.logo ?? false,
    map_score: Number(leagueTeam.series_wins ?? currentTeam?.map_score ?? 0),
    extra: currentTeam?.extra ?? {},
  } as TeamExtension;
};

const applyKnownTeamsToGame = <T extends Dota2 & { rawGsi?: unknown }>(game: T): T => {
  const rawGsiData = (game.rawGsi as any) ?? game;
  const leagueRadiant = getLeagueTeam(rawGsiData, "radiant");
  const leagueDire = getLeagueTeam(rawGsiData, "dire");
  const radiant = knownTeams.radiant || leagueRadiant;
  const dire = knownTeams.dire || leagueDire;

  if (!radiant && !dire) return game;

  return {
    ...game,
    map: {
      ...game.map,
      radiant: radiant ? { ...game.map.radiant, ...radiant } : game.map.radiant,
      dire: dire ? { ...game.map.dire, ...dire } : game.map.dire,
    },
  };
};

export const actions = new ActionManager();
export const configs = new ConfigManager();

export const hudIdentity = {
  name: "",
  isDev: false,
};

interface DataLoader {
  match: Promise<void> | null;
}

const dataLoader: DataLoader = {
  match: null,
};

class App extends React.Component<
  any,
  {
    game: (Dota2 & { items?: unknown; couriers?: unknown; rawGsi?: unknown }) | null;
    summary: GameSummary;
    steamids: string[];
    match: Match | null;
    checked: boolean;
  }
> {
  constructor(props: any) {
    super(props);
    this.state = {
      game: null,
      steamids: [],
      match: null,
      checked: false,
      summary: {
        players: {},
        tickSummary: {
          creepsKilled: [],
          abilitiesHit: [],
          abilitiesUsed: [],
        },
      },
    };
  }

  verifyPlayers = async (game: Dota2) => {
    const steamids = game.players.map((player) => player.steamid);
    steamids.forEach((steamid) => {
      loadAvatarURL(steamid);
    });

    if (steamids.every((steamid) => this.state.steamids.includes(steamid))) {
      return;
    }

    const loaded = DOTA2.players.map((player) => player.steamid);

    const extensioned = await api.players.get();

    const lacking = steamids
      .filter((steamid) => !loaded.includes(steamid))
      .filter((steamid) =>
        extensioned.map((player) => player.steamid).includes(steamid)
      );

    const players: PlayerExtension[] = extensioned
      .filter((player) => lacking.includes(player.steamid))
      .map((player) => ({
        id: player._id,
        name: player.username,
        realName: `${player.firstName} ${player.lastName}`,
        steamid: player.steamid,
        country: player.country,
        avatar: player.avatar,
        extra: player.extra,
      }));

    const gsiLoaded = DOTA2.players;

    gsiLoaded.push(...players);

    DOTA2.players = gsiLoaded;

    this.setState({ steamids });
  };

  applyDotaData = (data: any) => {
    if (!i) console.log(data);
    i = 1;

    if (isDotaParsedSnapshot(data)) {
      latestRawPayload = data.rawGsi || data;
      if (!this.state.game || this.state.steamids.length) {
        this.verifyPlayers(data);
      }
      (DOTA2 as any).last = data;
      this.setState({
        game: applyKnownTeamsToGame({
          ...data,
          items: data.rawItems ?? data.items ?? latestRawPayload?.items ?? null,
          couriers:
            data.rawCouriers ?? data.couriers ?? latestRawPayload?.couriers ?? null,
          rawGsi: latestRawPayload ?? null,
        }),
      });
      return;
    }

    latestRawPayload = sanitizeDigestPayload(data);
    DOTA2.digest(latestRawPayload);
  };

  componentDidMount() {
    this.loadMatch();
    const href = window.location.href;
    socket.emit("started");
    let isDev = false;
    let name = "";
    if (href.indexOf("/huds/") === -1) {
      isDev = true;
      name = (Math.random() * 1000 + 1)
        .toString(36)
        .replace(/[^a-z]+/g, "")
        .substr(0, 15);
      hudIdentity.isDev = true;
    } else {
      const segment = href.substr(href.indexOf("/huds/") + 6);
      name = segment.substr(0, segment.lastIndexOf("/"));
      hudIdentity.name = name;
    }

    socket.on("readyToRegister", () => {
      socket.emit("register", name, isDev, "dota2");
      initiateConnection();
    });
    socket.on(`hud_config`, (data: any) => {
      configs.save(data);
    });
    socket.on(`hud_action`, (data: any) => {
      actions.execute(data.action, data.data);
    });
    socket.on("keybindAction", (action: string) => {
      actions.execute(action);
    });

    window.addEventListener("keydown", (e) => {
      if (e.altKey && e.code === "KeyP") {
        e.preventDefault();
        console.log("[App] Alt+P pressed â€” executing showDraftRecap");
        actions.execute("showDraftRecap");
      }
    });

    socket.on("refreshHUD", () => {
      window.top && window.top.location.reload();
    });

    socket.on("combatLogUpdate", (summary: GameSummary) => {
      this.setState({ summary });
    });

    DOTA2.on("data", (data) => {
      if (!this.state.game || this.state.steamids.length)
        this.verifyPlayers(data);
      this.setState({
        game: applyKnownTeamsToGame({
          ...data,
          items: latestRawPayload?.items ?? null,
          couriers: latestRawPayload?.couriers ?? null,
          rawGsi: latestRawPayload ?? null,
        }),
      });
    });
    socket.on("dota2:data", this.applyDotaData);
    // Backwards compatibility: older server builds emit raw GSI snapshots as
    // "update" instead of "dota2:data". Both are routed through the same
    // sanitized handler so the draft timer keeps working either way.
    socket.on("update", this.applyDotaData);
    socket.on("match", () => {
      this.loadMatch(true);
    });
  }

  applyActiveMatchTeam = (side: "radiant" | "dire", team: TeamExtension) => {
    knownTeams = { ...knownTeams, [side]: team };
    DOTA2.teams[side] = team;
    this.setState((state) => {
      if (!state.game) return null;

      return {
        game: {
          ...state.game,
          map: {
            ...state.game.map,
            [side]: {
              ...state.game.map[side],
              ...team,
            },
          },
        },
      };
    });
  };

  loadMatch = async (force = false) => {
    if (!dataLoader.match || force) {
      dataLoader.match = new Promise((resolve) => {
        api.match
          .getCurrent()
          .then((match) => {
            if (!match) {
              dataLoader.match = null;
              knownTeams = {};
              this.setState({ match: null, checked: true });
              return;
            }
            this.setState({ match });
            let isReversed = false;
            let current = match.vetos.find((veto) => !veto.mapEnd);
            console.log(DOTA2.last && DOTA2.last.map.win_team);
            if (DOTA2.last && DOTA2.last.map.win_team !== "none") {
              const finished = match.vetos.filter((veto) => veto.mapEnd);
              const newCurrent = finished[finished.length - 1];
              if (newCurrent) {
                current = newCurrent;
              }
            }
            if (current && current.reverseSide) {
              isReversed = true;
            }
            this.setState({ checked: true });

            if (match.left.id) {
              api.teams.getOne(match.left.id).then((left) => {
                const gsiTeamData: TeamExtension = {
                  id: left._id,
                  name: left.name,
                  short_name: left.shortName,
                  country: left.country,
                  logo: left.logo,
                  map_score: match.left.wins,
                  extra: left.extra,
                };
                if (!isReversed) {
                  this.applyActiveMatchTeam("radiant", gsiTeamData);
                } else this.applyActiveMatchTeam("dire", gsiTeamData);
              });
            }
            if (match.right.id) {
              api.teams.getOne(match.right.id).then((right) => {
                const gsiTeamData: TeamExtension = {
                  id: right._id,
                  name: right.name,
                  short_name: right.shortName,
                  country: right.country,
                  logo: right.logo,
                  map_score: match.right.wins,
                  extra: right.extra,
                };

                if (!isReversed) this.applyActiveMatchTeam("dire", gsiTeamData);
                else this.applyActiveMatchTeam("radiant", gsiTeamData);
              });
            }
          })
          .catch(() => {
            //dataLoader.match = null;
          });
      });
    }
  };
  render() {
    if (!this.state.game) return null;
    return <Layout game={this.state.game} match={this.state.match} />;
  }
}
export default App;
