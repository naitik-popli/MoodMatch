import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { TooltipProvider } from "./components/ui/tooltip";
import MoodChat from "./pages/mood-chat";
import NotFound from "./pages/not-found";
import LocalStreamTest from "./pages/local-stream-test";
import { WebSocketProvider } from "./context/WebSocketContext";

function Router() {
  return (
    <WebSocketProvider>
    <Switch>
      <Route path="/" component={MoodChat} />
      <Route path="/local-stream-test" component={LocalStreamTest} />
      <Route component={NotFound} />
    </Switch>
    </WebSocketProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
