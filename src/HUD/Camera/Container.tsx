import React, { useEffect, useState } from "react";
import PlayerCamera from "./Camera";
import api from "../../api/api";
import "./index.scss";

const PLAYERS_REFRESH_MS = 3000;

const CameraContainer = ({ observedSteamid }: { observedSteamid: string | null }) => {
    const [ players, setPlayers ] = useState<string[]>([]);

    useEffect(() => {
        let mounted = true;

        const refreshPlayers = () => {
            api.camera.get().then(response => {
                if (!mounted) return;
                const nextPlayers = Array.isArray(response?.availablePlayers)
                    ? response.availablePlayers.map(player => player.steamid).filter(Boolean)
                    : [];
                setPlayers(nextPlayers);
            }).catch(() => {
                if (!mounted) return;
                setPlayers([]);
            });
        };

        refreshPlayers();
        const timer = window.setInterval(refreshPlayers, PLAYERS_REFRESH_MS);

        return () => {
            mounted = false;
            window.clearInterval(timer);
        };
    }, []);

    return <div id="cameras-container">
        {
            players.map(steamid => (<PlayerCamera key={steamid} steamid={steamid} visible={observedSteamid === steamid} />))
        }
    </div>
}

export default CameraContainer;
