import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { AttendanceScreen } from "../screens/AttendanceScreen";
import { ContactDetailScreen } from "../screens/ContactDetailScreen";
import { ContactsScreen } from "../screens/ContactsScreen";
import { FieldSalesScreen } from "../screens/FieldSalesScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { InvoiceDetailScreen } from "../screens/InvoiceDetailScreen";
import { InvoicesScreen } from "../screens/InvoicesScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { MoreScreen } from "../screens/MoreScreen";
import { NotificationsScreen } from "../screens/NotificationsScreen";
import { OrderDetailScreen } from "../screens/OrderDetailScreen";
import { OrdersScreen } from "../screens/OrdersScreen";
import { SearchScreen } from "../screens/SearchScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { StockScreen } from "../screens/StockScreen";
import { colors } from "../theme";
import type { Invoice } from "../types";

export type RootStackParamList = {
  Login: undefined;
  Tabs: undefined;
  Search: undefined;
  Notifications: undefined;
  Contacts: undefined;
  ContactDetail: { id: string; name?: string };
  Invoices: undefined;
  InvoiceDetail: { id: string; invoice?: Invoice };
  Orders: undefined;
  OrderDetail: { id: string };
  Settings: undefined;
};

export type TabParamList = {
  Home: undefined;
  FieldSales: undefined;
  Stock: undefined;
  Attendance: undefined;
  More: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.background, primary: colors.primary, card: "#fff", text: colors.text, border: colors.border },
};

function Tabs() {
  const { can, moduleOn } = useAuth();
  const show = (path: string) => can(path) && moduleOn(path);
  return (
    <Tab.Navigator
      screenOptions={{
        headerTitleStyle: { fontWeight: "800" },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontWeight: "700", fontSize: 11 },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: "Özet", tabBarIcon: ({ color, size }) => <Ionicons name="grid" color={color} size={size} /> }} />
      {show("/saha") ? (
        <Tab.Screen name="FieldSales" component={FieldSalesScreen} options={{ title: "Saha", tabBarIcon: ({ color, size }) => <Ionicons name="phone-portrait" color={color} size={size} /> }} />
      ) : null}
      {show("/stock") ? (
        <Tab.Screen name="Stock" component={StockScreen} options={{ title: "Stok", tabBarIcon: ({ color, size }) => <Ionicons name="barcode" color={color} size={size} /> }} />
      ) : null}
      {show("/mesai") ? (
        <Tab.Screen name="Attendance" component={AttendanceScreen} options={{ title: "Mesaim", tabBarIcon: ({ color, size }) => <Ionicons name="time" color={color} size={size} /> }} />
      ) : null}
      <Tab.Screen name="More" component={MoreScreen} options={{ title: "Daha", tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal" color={color} size={size} /> }} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { ready, user } = useAuth();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerTitleStyle: { fontWeight: "800" }, headerBackTitle: "Geri" }}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
            <Stack.Screen name="Search" component={SearchScreen} options={{ title: "Ara" }} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Bildirimler" }} />
            <Stack.Screen name="Contacts" component={ContactsScreen} options={{ title: "Cariler" }} />
            <Stack.Screen name="ContactDetail" component={ContactDetailScreen} options={{ title: "Cari" }} />
            <Stack.Screen name="Invoices" component={InvoicesScreen} options={{ title: "Faturalar" }} />
            <Stack.Screen name="InvoiceDetail" component={InvoiceDetailScreen} options={{ title: "Fatura" }} />
            <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: "Siparişler" }} />
            <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: "Sipariş" }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Ayarlar" }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
