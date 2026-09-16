import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { colors } from "@/theme";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

function AuthRedirect() {
  const { ready, user, b2bToken } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!ready) return;
    const onLogin = segments[0] === "login";
    const onB2b = segments[0] === "b2b";
    if (!user && !b2bToken && !onLogin) router.replace("/login");
    else if (user && (onLogin || onB2b)) router.replace("/");
    else if (b2bToken && !user && !onB2b) router.replace("/b2b");
  }, [ready, user, b2bToken, segments, router]);

  return null;
}

function RootStack() {
  const { ready, user, b2bToken } = useAuth();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  const initial = user ? "(tabs)" : b2bToken ? "b2b" : "login";
  return (
    <>
      <AuthRedirect />
      <Stack initialRouteName={initial} screenOptions={{ headerTitleStyle: { fontWeight: "800", color: colors.text }, headerBackTitle: "Geri", headerTintColor: colors.primary, headerStyle: { backgroundColor: colors.surface } }}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="b2b" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="search" options={{ title: "Ara" }} />
        <Stack.Screen name="notifications" options={{ title: "Bildirimler" }} />
        <Stack.Screen name="contacts/index" options={{ title: "Cariler" }} />
        <Stack.Screen name="contacts/[id]" options={{ title: "Cari" }} />
        <Stack.Screen name="invoices/index" options={{ title: "Faturalar" }} />
        <Stack.Screen name="invoices/[id]" options={{ title: "Fatura" }} />
        <Stack.Screen name="orders/index" options={{ title: "Siparişler" }} />
        <Stack.Screen name="orders/[id]" options={{ title: "Sipariş" }} />
        <Stack.Screen name="stock/new" options={{ title: "Yeni stok kartı" }} />
        <Stack.Screen name="stock/[id]" options={{ title: "Stok kartı" }} />
        <Stack.Screen name="settings" options={{ title: "Ayarlar" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <RootStack />
    </AuthProvider>
  );
}
