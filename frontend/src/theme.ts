import { createTheme } from "@mui/material/styles";

export const BELL_RED = "#e1251b";
export const NAVY = "#0b1f3a";
export const NAVY_LIGHT = "#13305a";

export const CHART_COLORS = ["#1f5fa8", "#e1251b", "#2e9d6a", "#f2a516", "#7b4fc4", "#00a3c4", "#8c6d46", "#5f6b7a", "#c2185b"];

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1f4f8b", dark: NAVY, contrastText: "#fff" },
    secondary: { main: BELL_RED, contrastText: "#fff" },
    error: { main: "#c62828" },
    warning: { main: "#ed8a00" },
    success: { main: "#2e7d4f" },
    info: { main: "#0277bd" },
    background: { default: "#f3f5f8", paper: "#ffffff" },
    text: { primary: "#1b2430", secondary: "#5b6676" },
    divider: "#e3e7ee",
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: '"Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: 13,
    h4: { fontWeight: 600, fontSize: "1.45rem" },
    h5: { fontWeight: 600, fontSize: "1.2rem" },
    h6: { fontWeight: 600, fontSize: "1rem" },
    subtitle2: { fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } }, defaultProps: { elevation: 0 } },
    MuiCard: { styleOverrides: { root: { border: "1px solid #e3e7ee" } } },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 600, color: "#3d4757", backgroundColor: "#f7f9fb", whiteSpace: "nowrap" },
        root: { borderColor: "#edf0f4", paddingTop: 8, paddingBottom: 8 },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
    MuiTab: { styleOverrides: { root: { textTransform: "none", fontWeight: 600, minHeight: 44 } } },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiSelect: { defaultProps: { size: "small" } },
  },
});
