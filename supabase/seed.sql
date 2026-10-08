-- Illustrative events. Dates are relative to the day this seed runs.
INSERT INTO public."Events" ("EventName", "EventCatagory", "EventLocation", "EventDate", "EventTime", "EventDescription") VALUES 
('Fall social on the lawn', 'Social', 'Maeser Lawn', current_date + 1, '18:00', 'Bring a blanket and meet someone new. Enjoy lawn games, music, and treats as the sun sets over campus.'),
('An evening of jazz', 'Arts', 'Music Building', current_date + 3, '19:00', 'An intimate evening of student jazz ensembles. Arrive 15 minutes early; seating is first come, first served.'),
('Build something together', 'Career', 'Tanner Building', current_date + 5, '17:30', 'Meet other builders at a collaborative technology workshop. Bring a laptop; beginners are welcome.'),
('A little time. A big difference.', 'Service', 'Wilkinson Center', current_date + 7, '16:00', 'Help assemble community care kits. Supplies are provided and friends are welcome.'),
('Cougar game night', 'Sports', 'Smith Fieldhouse', current_date + 9, '19:00', 'Cheer with fellow students at a sample campus sports night. Wear blue and bring your student ID.'),
('Crêpes & conversation', 'Culture', 'Wilkinson Center', current_date + 11, '18:00', 'Practice French over crêpes and casual conversation. All language levels are welcome.'),
('Pause & reflect', 'Spiritual', 'Marriott Center', current_date + 14, '11:00', 'A sample gathering for reflection, faith, and community. Please arrive before the start time.'),
('Sketch your Saturday', 'Arts', 'Museum of Art', current_date + 18, '10:00', 'Join a relaxed sketching session. Bring a sketchbook; pencils and inspiration are provided.'),
('Meet your next opportunity', 'Career', 'Tanner Building', current_date + 33, '15:00', 'Practice introductions and connect with peers. Bring a résumé if you would like informal feedback.'),
('Welcome week mixer', 'Social', 'Maeser Lawn', current_date - 3, '18:00', 'A relaxed start-of-semester mixer with games and treats.'),
('Community service afternoon', 'Service', 'Wilkinson Center', current_date - 8, '14:00', 'Students assembled care kits for community partners.');