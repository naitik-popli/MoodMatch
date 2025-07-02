import React, { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Checkbox } from "../components/ui/checkbox";

// Debugging utility
const debug = (context: string) => (...args: any[]) => {
  console.log(`[Settings:${context}]`, ...args);
};

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const log = debug('SettingsModal');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [selectedMicrophone, setSelectedMicrophone] = useState<string>("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Load saved settings from localStorage
  useEffect(() => {
    const savedSettings = localStorage.getItem('moodchat-settings');
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        log('Loaded saved settings', settings);
        setSelectedCamera(settings.camera || "");
        setSelectedMicrophone(settings.microphone || "");
        setNotificationsEnabled(settings.notifications !== false);
      } catch (e) {
        log('Error parsing saved settings', e);
      }
    }
  }, [log]);

  // Get media devices with permission handling
  const getDevices = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // First get a media stream to ensure permissions are granted
      const tempStream = await navigator.mediaDevices.getUserMedia({ 
        video: true,
        audio: true 
      });
      
      // Stop the temporary stream immediately
      tempStream.getTracks().forEach(track => track.stop());
      
      // Now enumerate devices with permissions
      const devices = await navigator.mediaDevices.enumerateDevices();
      log('Available devices', devices);

      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      const audioDevices = devices.filter(device => device.kind === 'audioinput');

      setCameras(videoDevices);
      setMicrophones(audioDevices);

      // Set default devices if none selected
      if (videoDevices.length > 0 && !selectedCamera) {
        setSelectedCamera(videoDevices[0].deviceId);
      }
      if (audioDevices.length > 0 && !selectedMicrophone) {
        setSelectedMicrophone(audioDevices[0].deviceId);
      }
    } catch (error) {
      log('Error accessing media devices:', error);
      setError('Could not access camera/microphone. Please check permissions.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedCamera, selectedMicrophone, log]);

  // Get devices on mount
  useEffect(() => {
    getDevices();
  }, [getDevices]);

  // Update video preview when camera changes
  useEffect(() => {
    const startPreview = async () => {
      if (!selectedCamera || !videoRef.current) return;

      log('Starting camera preview with device:', selectedCamera);
      
      // Stop previous stream if exists
      if (streamRef.current) {
        log('Stopping previous stream');
        streamRef.current.getTracks().forEach(track => {
          log(`Stopping track: ${track.kind}`, track);
          track.stop();
        });
        streamRef.current = null;
      }

      try {
        const constraints = { 
          video: { 
            deviceId: { exact: selectedCamera },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          } 
        };
        
        log('Requesting stream with constraints:', constraints);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        log('Obtained stream:', {
          id: stream.id,
          active: stream.active,
          videoTracks: stream.getVideoTracks().map(t => ({
            id: t.id,
            readyState: t.readyState,
            settings: t.getSettings()
          }))
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            log('Video metadata loaded', {
              videoWidth: videoRef.current?.videoWidth,
              videoHeight: videoRef.current?.videoHeight
            });
          };
          videoRef.current.onerror = (e) => {
            log('Video error:', e);
          };
        }
      } catch (error) {
        log("Error accessing camera:", error);
        setError(`Could not access camera: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    startPreview();

    return () => {
      // Cleanup on unmount
      if (streamRef.current) {
        log('Cleaning up preview stream');
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [selectedCamera, log]);

  const handleSave = () => {
    const settings = {
      camera: selectedCamera,
      microphone: selectedMicrophone,
      notifications: notificationsEnabled,
    };
    log('Saving settings:', settings);
    localStorage.setItem('moodchat-settings', JSON.stringify(settings));
    onClose();
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-md mb-4 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-6">
          {/* Video Preview */}
          <div className="w-full aspect-video bg-black rounded-lg overflow-hidden relative">
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
              </div>
            )}
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            {!selectedCamera && !isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black text-white">
                No camera selected
              </div>
            )}
          </div>

          {/* Camera selection */}
          <div>
            <Label htmlFor="camera" className="text-sm font-medium text-gray-700 mb-2 block">
              Camera
            </Label>
            <Select 
              value={selectedCamera} 
              onValueChange={setSelectedCamera}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoading ? "Loading..." : "Select camera"} />
              </SelectTrigger>
              <SelectContent>
                {cameras.map((camera) => (
                  <SelectItem key={camera.deviceId} value={camera.deviceId}>
                    {camera.label || `Camera ${camera.deviceId.slice(0, 8)}...`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Microphone selection */}
          <div>
            <Label htmlFor="microphone" className="text-sm font-medium text-gray-700 mb-2 block">
              Microphone
            </Label>
            <Select 
              value={selectedMicrophone} 
              onValueChange={setSelectedMicrophone}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoading ? "Loading..." : "Select microphone"} />
              </SelectTrigger>
              <SelectContent>
                {microphones.map((microphone) => (
                  <SelectItem key={microphone.deviceId} value={microphone.deviceId}>
                    {microphone.label || `Microphone ${microphone.deviceId.slice(0, 8)}...`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notifications toggle */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="notifications"
              checked={notificationsEnabled}
              onCheckedChange={(checked) => setNotificationsEnabled(checked === true)}
              disabled={isLoading}
            />
            <Label
              htmlFor="notifications"
              className="text-sm text-gray-700 cursor-pointer"
            >
              Enable notifications
            </Label>
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}