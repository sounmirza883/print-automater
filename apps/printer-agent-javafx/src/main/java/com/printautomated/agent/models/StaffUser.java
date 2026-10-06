package com.printautomated.agent.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class StaffUser {
    @JsonProperty("id")
    private String id = "";

    @JsonProperty("email")
    private String email = "";

    @JsonProperty("fullName")
    private String fullName = "";

    @JsonProperty("role")
    private String role = "";

    public StaffUser() {}

    public StaffUser(String id, String email, String fullName, String role) {
        this.id = id != null ? id : "";
        this.email = email != null ? email : "";
        this.fullName = fullName != null ? fullName : "";
        this.role = role != null ? role : "";
    }

    public String getId() { return id; }
    public String getEmail() { return email; }
    public String getFullName() { return fullName; }
    public String getRole() { return role; }

    public void setId(String id) { this.id = id; }
    public void setEmail(String email) { this.email = email; }
    public void setFullName(String fullName) { this.fullName = fullName; }
    public void setRole(String role) { this.role = role; }
}
