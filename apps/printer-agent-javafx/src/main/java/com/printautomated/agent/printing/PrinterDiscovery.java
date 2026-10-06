package com.printautomated.agent.printing;

import com.printautomated.agent.models.PrinterInfo;

import javax.print.PrintService;
import javax.print.PrintServiceLookup;
import javax.print.attribute.standard.Chromaticity;
import javax.print.attribute.standard.Media;
import javax.print.attribute.standard.Sides;
import java.util.ArrayList;
import java.util.List;

public class PrinterDiscovery {

    public static List<PrinterInfo> discoverPrinters() {
        List<PrinterInfo> result = new ArrayList<>();
        try {
            PrintService defaultService = PrintServiceLookup.lookupDefaultPrintService();
            String defaultName = defaultService != null ? defaultService.getName() : "";

            PrintService[] services = PrintServiceLookup.lookupPrintServices(null, null);
            for (PrintService service : services) {
                String name = service.getName();
                boolean isDefault = name.equalsIgnoreCase(defaultName);

                // Capability probes
                boolean isColor = service.isAttributeValueSupported(Chromaticity.COLOR, null, null);
                boolean isDuplex = service.isAttributeValueSupported(Sides.DUPLEX, null, null)
                        || service.isAttributeValueSupported(Sides.TWO_SIDED_LONG_EDGE, null, null);

                boolean supportsA4 = false;
                boolean supportsA3 = false;

                Object mediaValues = service.getSupportedAttributeValues(Media.class, null, null);
                if (mediaValues instanceof Media[]) {
                    for (Media media : (Media[]) mediaValues) {
                        String mediaName = media.toString().toLowerCase();
                        if (mediaName.contains("a4") || mediaName.contains("iso-a4")) supportsA4 = true;
                        if (mediaName.contains("a3") || mediaName.contains("iso-a3")) supportsA3 = true;
                    }
                }

                result.add(new PrinterInfo(name, isDefault, isColor, isDuplex, supportsA4, supportsA3, "Ready"));
            }
        } catch (Exception ignored) {
            // If print service lookup fails on a headless machine
        }

        if (result.isEmpty()) {
            result.add(new PrinterInfo("Microsoft Print to PDF", true, true, false, true, false, "Ready"));
        }

        return result;
    }
}
