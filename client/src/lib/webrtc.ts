const ICE_SERVERS = [
  // { urls: 'stun:stun.l.google.com:19302' },
  // { urls: 'stun:stun1.l.google.com:19302' },
  // {
  //   urls: 'turn:your.turnserver.com:3478',
  //   username: 'user',
  //   credential: 'pass',
  // },

   {urls: [ "stun:bn-turn2.xirsys.com" ]
}, {
   username: "kU30-GQQfMyOtuVj20xiAMXSgy5qN19EeOG8-yVX9S4oHwwVYViJivrdT2c5Kvt-AAAAAGhx97htb29kbWF0Y2g=",
   credential: "29634fe4-5ee4-11f0-9ea6-0242ac140004",
   urls: [
       "turn:bn-turn2.xirsys.com:80?transport=udp",
       "turn:bn-turn2.xirsys.com:3478?transport=udp",
       "turn:bn-turn2.xirsys.com:80?transport=tcp",
       "turn:bn-turn2.xirsys.com:3478?transport=tcp",
       "turns:bn-turn2.xirsys.com:443?transport=tcp",
       "turns:bn-turn2.xirsys.com:5349?transport=tcp"
   ]
   
  }

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

