const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:your.turnserver.com:3478',
    username: 'user',
    credential: 'pass',
  },
];

export function createPeerConnection(): RTCPeerConnection {
 return new RTCPeerConnection({
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 10, // optional performance improvement
});
}


export function getMediaConstraints() {
  return {
    video: {
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 30, max: 60 },
      facingMode: 'user', // front camera on mobile
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  };
}

