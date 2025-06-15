import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Checkbox } from "../components/ui/checkbox";

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [selectedMicrophone, setSelectedMicrophone] = useState<string>("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  useEffect(() => {
    // Get available media devices
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        const audioDevices = devices.filter(device => device.kind === 'audioinput');
        
        setCameras(videoDevices);
        setMicrophones(audioDevices);
        
        // Set default selections if devices are available
        if (videoDevices.length > 0 && !selectedCamera) {
          setSelectedCamera(videoDevices[0].deviceId);
        }
        if (audioDevices.length > 0 && !selectedMicrophone) {
          setSelectedMicrophone(audioDevices[0].deviceId);  
        }
      } catch (error) {
        console.error('Error getting media devices:', error);
      }
    };

    getDevices();
  }, [selectedCamera, selectedMicrophone]);

  const handleSave = () => {
    // Save settings to localStorage or send to server
    const settings = {
      camera: selectedCamera,
      microphone: selectedMicrophone,
      notifications: notificationsEnabled,
    };
    
    localStorage.setItem('moodchat-settings', JSON.stringify(settings));
    onClose();
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          <div>
            <Label htmlFor="camera" className="text-sm font-medium text-gray-700 mb-2 block">
              Camera
            </Label>
            <Select value={selectedCamera} onValueChange={setSelectedCamera}>
              <SelectTrigger>
                <SelectValue placeholder="Select camera" />
              </SelectTrigger>
              <SelectContent>
                {cameras.map((camera) => (
                  <SelectItem key={camera.deviceId} value={camera.deviceId || "default"}>
                    {camera.label || `Camera ${camera.deviceId?.slice(0, 8) || "default"}...`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="microphone" className="text-sm font-medium text-gray-700 mb-2 block">
              Microphone  
            </Label>
            <Select value={selectedMicrophone} onValueChange={setSelectedMicrophone}>
              <SelectTrigger>
                <SelectValue placeholder="Select microphone" />
              </SelectTrigger>
              <SelectContent>
                {microphones.map((microphone) => (
                  <SelectItem key={microphone.deviceId} value={microphone.deviceId || "default"}>
                    {microphone.label || `Microphone ${microphone.deviceId?.slice(0, 8) || "default"}...`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="notifications"
              checked={notificationsEnabled}
              onCheckedChange={(checked) => setNotificationsEnabled(checked === true)}
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
