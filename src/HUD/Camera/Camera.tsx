import React, { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from 'uuid';
import { mediaStreams } from "./mediaStream";
import { resolveDirectCameraUrl } from "../../api/directCamera";

type Props = {
    steamid: string,
    visible: boolean;
}

const DIRECT_CAMERA_REFRESH_MS = 500;
const PLAYBACK_RETRY_MS = 250;
const MAX_PLAYBACK_ATTEMPTS = 5;

const CameraView = ({ steamid, visible }: Props) => {
    const [uuid] = useState(uuidv4());
    const [ forceHide, setForceHide ] = useState(false);
    const [ directUrl, setDirectUrl ] = useState("");
    const [ enabled, setEnabled ] = useState(false);
    const [ hasVideoSource, setHasVideoSource ] = useState(false);
    const enabledRef = useRef(false);
    // Holds the live variant-3 (P2P WebRTC) stream so the variant-2 direct
    // camera poller can't tear it down.
    const p2pStreamRef = useRef<MediaStream | null>(null);
    const playbackRetryRef = useRef<number | null>(null);
    const secureContextWarningRef = useRef(false);
    const shouldShowBaseCamera = visible && !forceHide;
    const canUseDirectIframe = typeof window !== "undefined" && window.isSecureContext;
    const effectiveDirectUrl = canUseDirectIframe ? directUrl : "";
    const shouldShowIframe = shouldShowBaseCamera && Boolean(effectiveDirectUrl);
    const shouldShowVideo = shouldShowBaseCamera && hasVideoSource && !shouldShowIframe;

    const clearPlaybackRetry = () => {
        if (playbackRetryRef.current !== null) {
            window.clearTimeout(playbackRetryRef.current);
            playbackRetryRef.current = null;
        }
    };

    const getRemoteVideo = () => document.getElementById(`remote-video-${steamid}-${uuid}`) as HTMLVideoElement | null;

    const ensureVideoPlayback = (attempt = 0) => {
        const remoteVideo = getRemoteVideo();
        if (!remoteVideo) return;

        remoteVideo.autoplay = true;
        remoteVideo.defaultMuted = true;
        remoteVideo.muted = true;
        remoteVideo.playsInline = true;
        remoteVideo.setAttribute("autoplay", "");
        remoteVideo.setAttribute("muted", "");
        remoteVideo.setAttribute("playsinline", "");

        const playPromise = remoteVideo.play();
        if (!playPromise || typeof playPromise.catch !== "function") return;

        playPromise.catch(() => {
            if (attempt >= MAX_PLAYBACK_ATTEMPTS) return;
            clearPlaybackRetry();
            playbackRetryRef.current = window.setTimeout(() => {
                ensureVideoPlayback(attempt + 1);
            }, PLAYBACK_RETRY_MS);
        });
    };

    useEffect(() => {
        enabledRef.current = enabled;
    }, [enabled]);

    useEffect(() => {
        if (!directUrl || canUseDirectIframe || secureContextWarningRef.current) return;

        console.warn(
            "Direct camera iframe was disabled because the HUD is running in an insecure context. Open this HUD via https:// or http://localhost to allow embedded VDO.Ninja playback in Chromium-based browsers and OBS."
        );
        secureContextWarningRef.current = true;
    }, [canUseDirectIframe, directUrl]);

    useEffect(() => {
        let mounted = true;

        const disableCamera = () => {
            setEnabled(false);
            setDirectUrl("");
            // Only the V2 direct camera is being disabled - keep a live P2P stream.
            if (p2pStreamRef.current) return;
            const remoteVideo = getRemoteVideo();
            clearPlaybackRetry();
            if (remoteVideo) {
                remoteVideo.pause();
                remoteVideo.srcObject = null;
            }
            setHasVideoSource(false);
        };

        const refreshDirectUrl = () => {
            resolveDirectCameraUrl(steamid).then((result) => {
                if (!mounted) return;
                setEnabled(result.enabled);
                setDirectUrl(result.enabled ? (result.vdoUrl || "") : "");

                if (!result.enabled) {
                    disableCamera();
                }
            }).catch(() => {
                if (!mounted) return;
                disableCamera();
            });
        };

        refreshDirectUrl();
        const directUrlTimer = window.setInterval(refreshDirectUrl, DIRECT_CAMERA_REFRESH_MS);

        const mountStream = (stream: MediaStream) => {
            const remoteVideo = getRemoteVideo();
            if (!remoteVideo || !stream) return;

            p2pStreamRef.current = stream;
            remoteVideo.srcObject = stream;
            setHasVideoSource(true);

            ensureVideoPlayback();
        }

        const mountExistingStream = () => {
            const currentStream = mediaStreams.players.find(player => player.steamid === steamid);
            if(!currentStream || !currentStream.peerConnection || !currentStream.peerConnection._remoteStreams) return;

            const stream = currentStream.peerConnection._remoteStreams[0];

            if(!stream) return;

            mountStream(stream);
        }

        const onStreamCreate = (stream: MediaStream) => {
            mountStream(stream);
        }

        const onStreamDestroy = () => {
            p2pStreamRef.current = null;
            const remoteVideo = getRemoteVideo();

            if (!remoteVideo) return;

            clearPlaybackRetry();
            remoteVideo.pause();
            remoteVideo.srcObject = null;
            setHasVideoSource(false);
        }

        const onBlockedUpdate = (steamids: string[]) => {
            setForceHide(steamids.includes(steamid));
        }

        mediaStreams.onStreamCreate(onStreamCreate, steamid);
        mediaStreams.onStreamDestroy(onStreamDestroy, steamid);
        mediaStreams.onBlockedUpdate(onBlockedUpdate);

        mountExistingStream();

        return () => {
            mounted = false;
            clearPlaybackRetry();
            window.clearInterval(directUrlTimer);
            const remoteVideo = getRemoteVideo();
            if (remoteVideo) {
                remoteVideo.pause();
                remoteVideo.srcObject = null;
            }
            setHasVideoSource(false);
            mediaStreams.removeListener(onStreamCreate);
            mediaStreams.removeListener(onStreamDestroy);
            mediaStreams.removeListener(onBlockedUpdate);
        }
    }, [steamid, visible]);

    const iframeOpacity = shouldShowIframe ? 1 : 0;
    const videoOpacity = shouldShowVideo ? 1 : 0;

    return <React.Fragment>
        {
            effectiveDirectUrl ? <iframe
                className="video-call-preview video-call-preview-iframe"
                src={effectiveDirectUrl}
                allow="encrypted-media; sync-xhr; usb; web-share; midi *; geolocation; camera *; microphone *; fullscreen; picture-in-picture; display-capture; accelerometer; autoplay; gyroscope; screen-wake-lock"
                allowFullScreen
                referrerPolicy="no-referrer"
                loading="eager"
                title={`direct-camera-${steamid}`}
                style={{ opacity: iframeOpacity, pointerEvents: shouldShowIframe ? "auto" : "none" }}
            /> : null
        }
        <video className="video-call-preview" autoPlay muted playsInline id={`remote-video-${steamid}-${uuid}`} style={{ opacity: videoOpacity, pointerEvents: shouldShowVideo ? "auto" : "none" }}></video>
    </React.Fragment>
}

export default CameraView;
