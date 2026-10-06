package com.printautomated.agent.ui;

import javafx.application.Platform;
import javafx.stage.Stage;

import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.image.BufferedImage;

public class TrayManager {
    private final Stage stage;
    private final Runnable onOpenOrders;
    private TrayIcon trayIcon;

    public TrayManager(Stage stage, Runnable onOpenOrders) {
        this.stage = stage;
        this.onOpenOrders = onOpenOrders;
        initTray();
    }

    private void initTray() {
        if (!SystemTray.isSupported()) return;

        try {
            SystemTray tray = SystemTray.getSystemTray();
            Image image = createDefaultTrayIcon();

            PopupMenu menu = new PopupMenu();

            MenuItem openItem = new MenuItem("Open Print Automated");
            openItem.addActionListener(e -> Platform.runLater(this::showStage));

            MenuItem ordersItem = new MenuItem("Orders & Queue");
            ordersItem.addActionListener(e -> Platform.runLater(() -> {
                showStage();
                if (onOpenOrders != null) onOpenOrders.run();
            }));

            MenuItem quitItem = new MenuItem("Quit");
            quitItem.addActionListener(e -> Platform.runLater(() -> {
                if (trayIcon != null) tray.remove(trayIcon);
                Platform.exit();
                System.exit(0);
            }));

            menu.add(openItem);
            menu.add(ordersItem);
            menu.addSeparator();
            menu.add(quitItem);

            trayIcon = new TrayIcon(image, "Print Automated Agent", menu);
            trayIcon.setImageAutoSize(true);
            trayIcon.addMouseListener(new MouseAdapter() {
                @Override
                public void mouseClicked(MouseEvent e) {
                    if (e.getButton() == MouseEvent.BUTTON1) {
                        Platform.runLater(TrayManager.this::showStage);
                    }
                }
            });

            tray.add(trayIcon);
        } catch (Exception ignored) {}
    }

    private void showStage() {
        stage.show();
        stage.setIconified(false);
        stage.toFront();
        stage.requestFocus();
    }

    private Image createDefaultTrayIcon() {
        BufferedImage img = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setColor(new Color(0x23, 0x86, 0x36));
        g.fillRoundRect(1, 1, 14, 14, 4, 4);
        g.setColor(Color.WHITE);
        g.fillRect(4, 5, 8, 2);
        g.fillRect(4, 8, 8, 2);
        g.fillRect(4, 11, 5, 2);
        g.dispose();
        return img;
    }

    public void remove() {
        if (trayIcon != null && SystemTray.isSupported()) {
            SystemTray.getSystemTray().remove(trayIcon);
        }
    }
}
