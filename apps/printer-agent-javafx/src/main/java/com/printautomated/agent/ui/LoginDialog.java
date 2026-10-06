package com.printautomated.agent.ui;

import com.printautomated.agent.backend.AuthClient;
import com.printautomated.agent.backend.Session;
import com.printautomated.agent.models.StaffSession;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Scene;
import javafx.scene.control.*;
import javafx.scene.layout.*;
import javafx.stage.Modality;
import javafx.stage.Stage;

import java.util.function.Consumer;

public class LoginDialog {
    private final Stage stage;
    private final AuthClient authClient;
    private final Session session;
    private final Consumer<StaffSession> onSuccess;

    public LoginDialog(Stage owner, AuthClient authClient, Session session, Consumer<StaffSession> onSuccess) {
        this.authClient = authClient;
        this.session = session;
        this.onSuccess = onSuccess;

        stage = new Stage();
        stage.initOwner(owner);
        stage.initModality(Modality.APPLICATION_MODAL);
        stage.setTitle("Print Automated — Staff Sign In");
        stage.setResizable(false);

        initUI();
    }

    private void initUI() {
        VBox root = new VBox(16);
        root.setPadding(new Insets(24));
        root.setAlignment(Pos.CENTER_LEFT);
        root.getStyleClass().add("card-panel");
        root.setPrefWidth(420);

        Label title = new Label("Staff Sign In");
        title.getStyleClass().add("card-title");
        title.setStyle("-fx-font-size: 18px;");

        Label subtitle = new Label("Sign in with your Print Automated shop staff credentials to view live orders and manage print queues.");
        subtitle.getStyleClass().add("card-subtitle");
        subtitle.setWrapText(true);

        Label errorLabel = new Label();
        errorLabel.getStyleClass().addAll("status-pill", "pill-danger");
        errorLabel.setVisible(false);
        errorLabel.setManaged(false);

        VBox emailBox = new VBox(6);
        Label emailLabel = new Label("Email Address");
        emailLabel.setStyle("-fx-font-weight: 600; -fx-text-fill: #c9d1d9;");
        TextField emailField = new TextField();
        emailField.setPromptText("staff@example.com");
        emailBox.getChildren().addAll(emailLabel, emailField);

        VBox passwordBox = new VBox(6);
        Label passwordLabel = new Label("Password");
        passwordLabel.setStyle("-fx-font-weight: 600; -fx-text-fill: #c9d1d9;");
        PasswordField passwordField = new PasswordField();
        passwordField.setPromptText("Enter your password");
        passwordBox.getChildren().addAll(passwordLabel, passwordField);

        HBox buttonBox = new HBox(10);
        buttonBox.setAlignment(Pos.CENTER_RIGHT);
        buttonBox.setPadding(new Insets(8, 0, 0, 0));

        Button cancelButton = new Button("Cancel");
        cancelButton.getStyleClass().add("btn-secondary");
        cancelButton.setOnAction(e -> stage.close());

        Button signInButton = new Button("Sign In");
        signInButton.getStyleClass().add("btn-primary");
        signInButton.setDefaultButton(true);

        signInButton.setOnAction(e -> {
            String email = emailField.getText().trim();
            String password = passwordField.getText();
            if (email.isEmpty() || password.isEmpty()) {
                errorLabel.setText("Please enter both email and password.");
                errorLabel.setVisible(true);
                errorLabel.setManaged(true);
                return;
            }

            signInButton.setDisable(true);
            signInButton.setText("Signing in...");
            errorLabel.setVisible(false);
            errorLabel.setManaged(false);

            new Thread(() -> {
                try {
                    StaffSession newSession = authClient.login(email, password);
                    session.set(newSession);
                    Platform.runLater(() -> {
                        if (onSuccess != null) onSuccess.accept(newSession);
                        stage.close();
                    });
                } catch (Exception ex) {
                    Platform.runLater(() -> {
                        signInButton.setDisable(false);
                        signInButton.setText("Sign In");
                        errorLabel.setText("Sign in failed: " + ex.getMessage());
                        errorLabel.setVisible(true);
                        errorLabel.setManaged(true);
                    });
                }
            }).start();
        });

        buttonBox.getChildren().addAll(cancelButton, signInButton);
        root.getChildren().addAll(title, subtitle, errorLabel, emailBox, passwordBox, buttonBox);

        Scene scene = new Scene(root);
        scene.getStylesheets().add(getClass().getResource("/com/printautomated/agent/styles/main.css").toExternalForm());
        stage.setScene(scene);
    }

    public void show() {
        stage.showAndWait();
    }
}
