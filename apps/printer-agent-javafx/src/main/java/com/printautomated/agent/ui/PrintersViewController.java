package com.printautomated.agent.ui;

import com.printautomated.agent.models.PrinterInfo;
import com.printautomated.agent.printing.PrinterDiscovery;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.ScrollPane;
import javafx.scene.layout.*;

import java.util.List;

public class PrintersViewController {
    private VBox view;
    private FlowPane printersPane;
    private Label countLabel;

    public PrintersViewController() {
        initUI();
        reloadPrinters();
    }

    private void initUI() {
        view = new VBox(16);
        view.setPadding(new Insets(20));
        view.getStyleClass().add("content-area");

        HBox header = new HBox(12);
        header.setAlignment(Pos.CENTER_LEFT);

        VBox titleBox = new VBox(2);
        Label title = new Label("Connected Printers");
        title.getStyleClass().add("card-title");
        title.setStyle("-fx-font-size: 18px;");

        countLabel = new Label("Scanning system queues...");
        countLabel.getStyleClass().add("card-subtitle");
        titleBox.getChildren().addAll(title, countLabel);

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        Button refreshBtn = new Button("Re-scan Printers");
        refreshBtn.getStyleClass().add("btn-secondary");
        refreshBtn.setOnAction(e -> reloadPrinters());

        header.getChildren().addAll(titleBox, spacer, refreshBtn);

        printersPane = new FlowPane();
        printersPane.setHgap(16);
        printersPane.setVgap(16);
        printersPane.setPadding(new Insets(8, 0, 16, 0));

        ScrollPane scrollPane = new ScrollPane(printersPane);
        scrollPane.setFitToWidth(true);
        scrollPane.setStyle("-fx-background: transparent; -fx-background-color: transparent; -fx-border-color: transparent;");
        VBox.setVgrow(scrollPane, Priority.ALWAYS);

        view.getChildren().addAll(header, scrollPane);
    }

    public void reloadPrinters() {
        new Thread(() -> {
            List<PrinterInfo> list = PrinterDiscovery.discoverPrinters();
            Platform.runLater(() -> {
                printersPane.getChildren().clear();
                countLabel.setText(String.format("%d print %s found on this computer", list.size(), list.size() == 1 ? "queue" : "queues"));

                for (PrinterInfo p : list) {
                    printersPane.getChildren().add(createPrinterCard(p));
                }
            });
        }).start();
    }

    private VBox createPrinterCard(PrinterInfo p) {
        VBox card = new VBox(10);
        card.getStyleClass().add("card-panel");
        card.setPrefWidth(300);
        card.setPadding(new Insets(16));

        HBox top = new HBox(8);
        top.setAlignment(Pos.CENTER_LEFT);

        Label name = new Label(p.getName());
        name.setStyle("-fx-font-size: 14px; -fx-font-weight: bold; -fx-text-fill: #f0f6fc;");
        HBox.setHgrow(name, Priority.ALWAYS);

        top.getChildren().add(name);
        if (p.isDefault()) {
            Label defBadge = new Label("DEFAULT");
            defBadge.getStyleClass().addAll("status-pill", "pill-info");
            top.getChildren().add(defBadge);
        }

        FlowPane capabilities = new FlowPane();
        capabilities.setHgap(6);
        capabilities.setVgap(6);

        if (p.isColor()) {
            Label c = new Label("Color");
            c.getStyleClass().addAll("status-pill", "pill-success");
            capabilities.getChildren().add(c);
        } else {
            Label m = new Label("Monochrome");
            m.getStyleClass().addAll("status-pill", "pill-neutral");
            capabilities.getChildren().add(m);
        }

        if (p.isDuplex()) {
            Label d = new Label("Duplex");
            d.getStyleClass().addAll("status-pill", "pill-success");
            capabilities.getChildren().add(d);
        }

        if (p.isSupportsA4()) {
            Label a4 = new Label("A4");
            a4.getStyleClass().addAll("status-pill", "pill-neutral");
            capabilities.getChildren().add(a4);
        }

        if (p.isSupportsA3()) {
            Label a3 = new Label("A3");
            a3.getStyleClass().addAll("status-pill", "pill-neutral");
            capabilities.getChildren().add(a3);
        }

        Label status = new Label("Status: " + p.getStatus());
        status.setStyle("-fx-text-fill: #8b949e; -fx-font-size: 12px;");

        card.getChildren().addAll(top, capabilities, status);
        return card;
    }

    public VBox getView() { return view; }
}
