import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

/** §89 Shop App: "display offline status" -- the rest of §89 (preserve
 * safe local UI state, prevent duplicate operations, synchronize on
 * reconnect) is Phase 10.7's job, once there's real mutable UI state
 * and in-flight API calls in this app to preserve/block/resync. This
 * hook is only the detection primitive that work builds on. */
export function useIsOffline(): boolean {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      setIsOffline(state.isConnected === false);
    });
  }, []);

  return isOffline;
}
