import { useEffect, useState } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";
export function useColorScheme() { const [hasHydrated,setHasHydrated]=useState(false); useEffect(()=>{setHasHydrated(true);},[]); const colorScheme=useRNColorScheme(); return hasHydrated?colorScheme:"light"; }
