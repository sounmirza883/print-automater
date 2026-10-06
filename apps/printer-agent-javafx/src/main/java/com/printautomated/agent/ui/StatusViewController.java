package com.printautomated.agent.ui;

import com.printautomated.agent.backend.AgentStatusClient;
import com.printautomated.agent.models.AgentStatus;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.*;
import javafx.scene.layout.*;

import java.util.function.Consumer;

public class StatusViewController {
    private final AgentStatusClient statusClient;
    private final Consumer<String> onNavigateToOrders;

    private VBox view;
    private Label heroStatusTitle;
    private Label heroStatusSubtitle;
    private Label heroStatusPill;

    private Label metricPrinters;
    private Label metricHeartbeat;
    private Label metricShop;
    private Label metricDevice;

    private VBox pairingCard;
    private TextField pairingCodeField;
    private Button pairButton;
    private Label pairingErrorLabel;

    private VBox problemCard;
    private Label problemMessage;

    public StatusViewController(AgentStatusClient statusClient, Consumer<String> onNavigateToOrders) {
        this.statusClient = statusClient;
        this.onNavigateToOrders = onNavigateToOrders;
        initUI();
    }

    private void initUI() {
        view = new VBox(18);
        view.setPadding(new Insets(20));
        view.getStyleClass().add("content-area");

        // Hero Status Card
        VBox heroCard = new VBox(12);
        heroCard.getStyleClass().add("card-panel");
        heroCard.setStyle("-fx-background-color: #161b22; -fx-padding: 20;");

        HBox heroHeader = new HBox(12);
        heroHeader.setAlignment(Pos.CENTER_LEFT);

        VBox heroText = new VBox(4);
        heroStatusTitle = new Label("Connecting to Print Automated...");
        heroStatusTitle.getStyleClass().add("card-title");
        heroStatusTitle.setStyle("-fx-font-size: 18px;");

        heroStatusSubtitle = new Label("Agent background service status and pairing state");
        heroStatusSubtitle.getStyleClass().add("card-subtitle");
        heroText.getChildren().addAll(heroStatusTitle, heroStatusSubtitle);

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        heroStatusPill = new Label("CHECKING");
        heroStatusPill.getStyleClass().addAll("status-pill", "pill-warning");

        heroHeader.getChildren().addAll(heroText, spacer, heroStatusPill);
        heroCard.getChildren().add(heroHeader);

        // Problem Callout Card (hidden by default)
        problemCard = new VBox(8);
        problemCard.getStyleClass().add("card-panel");
        problemCard.setStyle("-fx-border-color: #f85149; -fx-background-color: rgba(248,81,73,0.1);");
        problemCard.setVisible(false);
        problemCard.setManaged(false);

        Label problemTitle = new Label("Attention Needed");
        problemTitle.setStyle("-fx-font-weight: bold; -fx-text-fill: #f85149;");
        problemMessage = new Label();
        problemMessage.setStyle("-fx-text-fill: #e6edf3;");
        problemMessage.setWrapText(true);
        problemCard.getChildren().addAll(problemTitle, problemMessage);

        // Metric Grid (4 cards)
        GridPane grid = new GridPane();
        grid.setHgap(14);
        grid.setVgap(14);

        for (int i = 0; i < 4; i++) {
            ColumnConstraints col = new ColumnConstraints();
            col.setPercentWidth(25);
            grid.getColumnConstraints().add(col);
        }

        metricPrinters = createMetricValue("0");
        VBox card1 = createMetricCard("CONNECTED PRINTERS", metricPrinters);

        metricHeartbeat = createMetricValue("Never");
        VBox card2 = createMetricCard("LAST HEARTBEAT", metricHeartbeat);

        metricShop = createMetricValue("Unassigned");
        VBox card3 = createMetricCard("LINKED BUSINESS", metricShop);

        metricDevice = createMetricValue("-");
        VBox card4 = createMetricCard("COMPUTER ID", metricDevice);

        grid.add(card1, 0, 0);
        grid.add(card2, 1, 0);
        grid.add(card3, 2, 0);
        grid.add(card4, 3, 0);

        // Pairing Card
        pairingCard = new VBox(14);
        pairingCard.getStyleClass().add("card-panel");
        pairingCard.setPadding(new Insets(20));

        Label pairTitle = new Label("Pair This Computer with Print Automated");
        pairTitle.getStyleClass().add("card-title");

        Label pairHint = new Label("In your shop portal, go to Printers -> 'Pair a computer' to generate an 8-character code, then enter it here:");
        pairHint.getStyleClass().add("card-subtitle");

        HBox pairForm = new HBox(12);
        pairForm.setAlignment(Pos.CENTER_LEFT);

        pairingCodeField = new TextField();
        pairingCodeField.setPromptText("ABCD-1234");
        pairingCodeField.setPrefWidth(200);
        pairingCodeField.getStyleClass().add("pairing-input");
        pairingCodeField.textProperty().addListener((obs, oldVal, newVal) -> {
            if (newVal != null) {
                pairingCodeField.setText(newVal.toUpperCase().replaceAll("[^A-Z0-9-]", ""));
            }
        });

        pairButton = new Button("Pair Computer");
        pairButton.getStyleClass().add("btn-primary");
        pairButton.setOnAction(e -> doPair());

        pairingErrorLabel = new Label();
        pairingErrorLabel.getStyleClass().addAll("status-pill", "pill-danger");
        pairingErrorLabel.setVisible(false);
        pairingErrorLabel.setManaged(false);

        pairForm.getChildren().addAll(pairingCodeField, pairButton, pairingErrorLabel);
        pairingCard.getChildren().addAll(pairTitle, pairHint, pairForm);

        view.getChildren().addAll(heroCard, problemCard, grid, pairingCard);
    }

    private VBox createMetricCard(String label, Label valueLabel) {
        VBox card = new VBox(6);
        card.getStyleClass().add("metric-card");
        Label l = new Label(label);
        l.getStyleClass().add("metric-label");
        card.getChildren().addAll(l, valueLabel);
        return card;
    }

    private Label createMetricValue(String text) {
        Label l = new Label(text);
        l.getStyleClass().add("metric-value");
        return l;
    }

    public void updateStatus(AgentStatus status) {
        if (status == null) return;

        metricPrinters.setText(String.valueOf(status.getPrinters()));
        metricHeartbeat.setText(status.getLastHeartbeatAt().isEmpty() ? "None" : formatTime(status.getLastHeartbeatAt()));
        metricShop.setText(status.getShop().isEmpty() ? "Not linked" : status.getShop());
        metricDevice.setText(status.getDevice().isEmpty() ? "Unset" : abbreviate(status.getDevice()));

        if (status.getLastError() != null && !status.getLastError().isEmpty()) {
            problemMessage.setText(status.getLastError());
            problemCard.setVisible(true);
            problemCard.setManaged(true);
        } else {
            problemCard.setVisible(false);
            problemCard.setManaged(false);
        }

        if (status.isPairing()) {
            heroStatusTitle.setText("Pairing Computer...");
            heroStatusSubtitle.setText("Exchanging device key challenge with the service");
            heroStatusPill.setText("PAIRING");
            heroStatusPill.getStyleClass().setAll("status-pill", "pill-warning");
            pairingCard.setVisible(true);
            pairingCard.setManaged(true);
        } else if (status.isPaired()) {
            heroStatusTitle.setText("Connected and Ready to Print");
            heroStatusSubtitle.setText("Agent is active and long-polling for print jobs");
            heroStatusPill.setText("ACTIVE");
            heroStatusPill.getStyleClass().setAll("status-pill", "pill-success");
            pairingCard.setVisible(false);
            pairingCard.setManaged(false);
        } else {
            heroStatusTitle.setText("Computer Not Paired");
            heroStatusSubtitle.setText("Enter your pairing code below to connect this station to your business");
            heroStatusPill.setText("NOT PAIRED");
            heroStatusPill.getStyleClass().setAll("status-pill", "pill-warning");
            pairingCard.setVisible(true);
            pairingCard.setManaged(true);
        }
    }

    private void doPair() {
        String code = pairingCodeField.getText().trim();
        if (code.isEmpty()) {
            showPairError("Please enter the 8-character pairing code.");
            return;
        }

        pairButton.setDisable(true);
        pairButton.setText("Pairing...");
        pairingErrorLabel.setVisible(false);
        pairingErrorLabel.setManaged(false);

        new Thread(() -> {
            try {
                statusClient.pair(code);
                Platform.runLater(() -> {
                    pairButton.setDisable(false);
                    pairButton.setText("Pair Computer");
                    pairingCodeField.clear();
                    // Re-fetch
                    AgentStatus s = statusClient.fetchStatus();
                    updateStatus(s);
                });
            } catch (Exception ex) {
                Platform.runLater(() -> {
                    pairButton.setDisable(false);
                    pairButton.setText("Pair Computer");
                    showPairError("Pairing error: " + ex.getMessage());
                });
            }
        }).start();
    }

    private void showPairError(String msg) {
        pairingErrorLabel.setText(msg);
        pairingErrorLabel.setVisible(true);
        pairingErrorLabel.setManaged(true);
    }

    private String formatTime(String iso) {
        if (iso.length() > 19) {
            return iso.substring(11, 19) + " UTC";
        }
        return iso;
    }

    private String abbreviate(String str) {
        if (str.length() > 12) {
            return str.substring(0, 10) + "...";
        }
        return str;
    }

    public VBox getView() { return view; }
}
