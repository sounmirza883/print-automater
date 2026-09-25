export type Testimonial = {
  quote: string;
  name: string;
  role: string;
  /** Fictional placeholder shop. */
  shop: string;
};

export const testimonialsNote = "Placeholder testimonials from fictional shops, shown for layout.";

export const testimonials: Testimonial[] = [
  {
    quote:
      "Orders used to arrive as emails and USB sticks. Now they land in one queue and the right printer picks them up.",
    name: "Amira Haddad",
    role: "Owner",
    shop: "Corner Press Co.",
  },
  {
    quote:
      "When a printer jams overnight, jobs move to another one. I read about it in the morning instead of fixing it at midnight.",
    name: "Daniel Okafor",
    role: "Operations lead",
    shop: "Brightline Copy & Print",
  },
  {
    quote:
      "The counter staff stopped asking which file is which. Everything is labelled and tracked from upload to pickup.",
    name: "Priya Nair",
    role: "Front desk manager",
    shop: "Paperwing Studio",
  },
  {
    quote:
      "Paper stock alerts alone paid for it. We stopped running out of A3 in the middle of a rush.",
    name: "Tomas Berg",
    role: "Owner",
    shop: "Nordic Sheet Works",
  },
  {
    quote:
      "Students upload from their phones and get a price straight away. Fewer questions, fewer mistakes.",
    name: "Lucia Fernandez",
    role: "Manager",
    shop: "Campus Copy Hub",
  },
  {
    quote:
      "Roles and the audit log let me hand the counter to new staff without worrying who can change prices.",
    name: "Kwame Mensah",
    role: "Co-founder",
    shop: "Inkwell & Sons",
  },
];
