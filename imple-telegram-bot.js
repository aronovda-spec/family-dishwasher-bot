[33mcommit db4937279115730db56da66ac84854e67b02d619[m[33m ([m[1;36mHEAD[m[33m -> [m[1;32mmain[m[33m, [m[1;31morigin/main[m[33m)[m
Author: daniel.aronov@dfmpower.com <daniel.aronov@dfmpower.com>
Date:   Wed Sep 17 15:35:54 2025 +0300

     ADD: Monthly Report System Foundation
    
     NEW FEATURE IMPLEMENTED:
     Monthly Report generation and display system
     Comprehensive data tracking infrastructure
     Admin menu integration with  Monthly Report button
     Full Hebrew translation support
    
     REPORT STRUCTURE (As Requested):
     USER STATISTICS (Eden, Adele, Emma):
    -  Completions: [count]
    -  Punishments received: [count]
    -  Days suspended: [count]
    -  Swaps requested: [count]
    -  Punishment requests made: [count]
    
     ADMIN STATISTICS (Dani + others):
    -  Completions (helped): [count]
    -  Punishments applied: [count]
    -  Force swaps: [count]
    -  Announcements: [count]
    
     TOTALS:
    - Total dishes completed: [count]
    - Admin interventions: [count]
    - Queue reorders: [count]
    
     TECHNICAL IMPLEMENTATION:
    
     Data Structures:
    - monthlyStats Map: month-year  {users, admins, totals}
    - Automatic month initialization for all 3 users
    - Admin stats created dynamically as needed
    
     Helper Functions:
    - getCurrentMonthKey(): '2024-12' format
    - initializeMonthlyStats(): Setup month data structure
    - trackMonthlyAction(): Record all user/admin actions
    - generateMonthlyReport(): Create formatted report in user's language
    
     TRANSLATIONS ADDED:
    English: 'monthly_report', 'user_statistics', 'admin_statistics', 'completions_count', etc.
    Hebrew: 'דוח חודשי', 'סטטיסטיקות משתמשים', 'סטטיסטיקות מנהלים', etc.
    
     ADMIN MENU INTEGRATION:
    New button:  Monthly Report  Shows current month's data
    Position: Above Maintenance (high visibility for important feature)
    
     CURRENT STATUS:
     Report infrastructure complete
     Manual report generation working
     Next: Integrate tracking calls throughout existing code
     Future: Automatic end-of-month broadcasting
    
    **Example Usage:**
    Admin   Monthly Report  View comprehensive monthly statistics
    
    The foundation for family accountability and insights is ready!

simple-telegram-bot.js
