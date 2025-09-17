<!--- ####################################################################################################################
Version 5.0.1 
File	inc_report_main_heading.cfm
No	Date		By		Log
001	20040808	csl		add param setexcelborder
002	20050308	csl		no chg
003	20060210	lcw		add export to Excel function
004	20060211	csl		style amend new td
005	20071026	lcw		fix error
006	20071106	Saravanan	Blank Page
007	20110715	Saravanan	revert old code
008	20110728	Hai		convert from inc_report_heading_lnk.cfm
009	20110728	Hai		add heading bar dynamically
010	20110803	Hai		change button lable from Lang to Language & change table height below the bar to 21
011	20110810	Hai		fix IE6 compatibility for control bar
						and Export to excel bug that requires to click "Excel button" 2 times
012	20110824	Maurice		Remove Changes
013	20110825	Hai		fix bugs when printing multiple pages, the tr tr_tbl_backCover should be set to none
016	20110901	Maurice		Add new image for csv export
014	20110825	ckt		change table id headlnk to headmain as it being defined in inc_report_main_heading_lnk.cfm
015	20110829	Maurice		Add export to csv function
017	20110919	Maurice		Add Checking to csv export
018	20110927	Sonny		added prn_divc for White Feather Printing Settings
019	20110928	Hai		fix checking prn_divc (shouldn't be prn_diva)
020	20111025	Saravanan	donot display language and entity option for fr_stk_take
021	20111102	Maurice		Fix problem with csv export
022	20111212	Maurice		Fix for multi header in csv export
023	20111213	chiaann		hide table (tr-id:tr_tbl_backCover), change style.top (function SelectComp)
024	20120131	oliver		cfparam subscribed_lang_cnt
025	20121109	chiaann		add fromemailproc
026	20130305	oliver		for New button shown in inc_report_main_heading.cfm
027	20130306	oliver		relocate New button to be in front of print
028	20130313	tks		add can_new_yn and chg_lang_yn
029	20130613	tks		add NotePad function
030	20140303	oliver		enhance ExportExcel function
032	20140813	Saravanan	fix fnm for email attachment issues
033	20140925	Saravanan	pdf log for fr_gst_f3form_my
034	20141026	oliver		amend empty_image()
035	20141218	Maurice		add <br> filter
036	20150818	sonny		fix for IE/Edge/Firefox/Chrome
037	20150820	harley		cross browser fix for headmain fixed right
038	20151118	harley		New Cross Browser Export to CSV, degrades to old method for Compat View
039	20160120	Ngoc Quan	Add button CSV for Xtra Design
040	20160225	harley		set position to fixed for top bar
041	20160301	harley		add div wrapper IE bug fix
042	20160328	harley		New Cross Browser Mmethod for export to Excel - Cross Browser
043	20160415	Saravanan	Fix Position
044	20160419	harley		Export to Excel user link innerHTML rather than text for multi line display
045	20160909	HungNV		FMT and PWL added
046	20160118	Maurice		Added Preview Function
046	20160118	Maurice		Added Preview Function (Remove Link Tag)
047	20170223	HungNV		add payslip worker and slary vouchet worker Number Format
048	20170228	Ngoc Quan	Add more case to check IE compatible view when export (navigator.userAgent.indexOf("MSIE 7.0") >= 0)
049	20170331	HungNV		add FMT for salary voucher and payslip worker cycle
050	20170615	Edmund		fix window.print bug
051	20170927	csl		amend style
052	20171017	Saravanan	changes for ent_adv_src_yn.
053	20171019	chiaann		add cell_input_lay_rpt2 in js:get_table_header for new class style
054	20171118	csl		hide preview button if report <cfif len(fromreport) LT "5">
055	20180219	Nick		updated to len(fromreport) gt 5
056	20180314	Anthony		Add multi_type for multi-print function - TSK-16939
057	20180619	Saravanan	no button when from_autoemail is 'y'
058	20181015 	Anthony		Add button PWL for alricmfn - TSK-17512
059 	20190306	Nick		ess_gen_payslip,ess_payslip", fromsegm)>	<cfset active_fmt_yn='y, added
060.	20190410	Ngoc Quan	Remove jquery.min for fr_prj_progress_curve_rpt
061.	20190511	csl		change query to cookie.cooksql_mainsync
062.	20191220	TranLuong	bug fix show print out ISMY - TSK-19890
063.	20200321	ckt		add fntcalib_redefine_yn to re-define style fntcalib14, fntcalib16 and fntcalib18 for cds
064.	20200330	Maurice		Foxed back hide issue
065.	20200401	ckt		sdd cfparam on papersize_width
066. 	20200629 	Tran Thanh 	amend pg_header in ExportCSV_cross for Hoyu (TSK-20558)
067. 	20200828 	Tran Thanh 	add fromsegm imp_do_data for Mega Group (TSK-21149)
068.	20200919	oliver		put back param setexcelborder
069.	20201015	oliver		add no_excel_rpt_list to exclude heavy report to export to excel which caused server hang.
070.	20201016	Maurice		Add Limit to Excel
071.	20201019	Maurice		Change Limit
072.	20201019	Maurice		Remove Change Limit
073. 	20210222	Huy Phan 	fixed <= character when export csv - TSK-21999
074.	20210303	saravanan	fix reporting server cors
075.	20210317	oliver		check the access right
076.	20210319	oliver		reverse back changes on 20210317
077.	20210507	Vinh		fix CSV format only have 1 output page for hrm_pymnt_detail_rpt for Spectrum - TSK-22375
078. 	20210519	Tran Thanh 	amend function ExportExcel of fr_e_invoice_rpt for Yon Ming (N/A)
079.	20210520	Edwin		Add cfparam is_cloud_hosting_yn
080.	20211109	Weida		add fr_proj_bud_ytd_pbud_cost to export csv all page
081.	20220207	Lopper 		Add showNumberCSV for Keppel
082.	20220223	Huy Phan 	add condition to fix the missing zero front and back stock code issue at export csv function - TSK-23839
083.	20220225 	Huy Phan 	get the date value out of the condition above
084.	20220225 	Huy Phan 	get the date value (ddmmyy) out of the condition above
085. 	20220302	Huy Phan 	Back to 20220207 version
086.	20220404	Huy Phan 	Added style mso-number-format:'\@ to fix the issue of missing zero front and back stock code issue at export excel function
087.	20220404	Huy Phan 	Re-checkin to esier for compare source code
088.	20220418	NamLee		add function emptyDiv() when fromreport is fr_prj_s_curve for Welltech (TSK-23914)
089. 	20220511 	Neoo 		fixed FMT for payslip is not working for TNO Systems (TSK-24218)
090.	20221102	NamLee		change color text when fromreport is fr_sal_daily for IC Resource (TSK-NA)
091 	20230117 	Nick 		fr_payroll_voucher_rpt >> fr_salary_voucher
092 	20230131 	PhatDo 		fix to show csv all page for fr_fin_ar_soa - SUPER BEND - TSK-25386 
093 	20230203 	Min 		Fix export csv for G3MY - TSK-25402
094 	20230207 	Min 		Fix export excel for G3MY - TSK-25402
095 	20230412 	ThaiTran 	add export excel input column for fr_dem_plan for JR Auto - TSK-25556
096.	20230710	Weida		add fr_fin_debtor at export_to_csv_all_page
097.	20231027	NamLee		add can_csv_yn is n for fr_trx_dtl_rep for BS Technology (TSK-26793)
098.	20231031	NamLee		revert version 20230710
099.	20231121	Tom			Fix error problem during load missing file .css when export excel for all report
100.	20231220	oliver		for cschold5500129mfn, by pass Excel download size totalmb checking
101.	20231221	Min		Add function emptyDiv() when fromreport is fr_grp_wage_type_variance,fr_wage_type_variance_rpt for CSC - TSK-27084
102.	20240315	ruc		exclude jquery from project cashflow projection reports to avoid conflic due to cannot load jqplot chart
103.	20240506	Weida		add remove imgs at clean_for_excel
104.	20240604	DingYong	add js checking for page load
105.	20240610	DingYong	add exclude_pageload_js_check_list
106.	20240611	DingYong	add fr_dem_plan for exclude_pageload_js_check_list & add exclude_pageload_js_check_list for ExportCSV
107.	20240619	Phat		add fr_yearly_pyrl_by_staff,fr_payroll_payslip_rpt for exclude_pageload_js_check_list  - TSK-28221 - Shinfox
108.	20240702	Phat		add changeDisplayExcel(fr_occ_emp_data)- LTC -TSK-28306
109.    20240708        ThanhHung       added vle_remove_image_excel_yn to show image in export excel (TSK-28223)
110.	20241018	Phat		add hrm_payrl_ear_wk_rpt for exclude_pageload_js_check_list  - TSK-29006 - ICF
111.	20241024	Huy Phan	fix for export excel missing zero front and back stock code issue
112.	20241025	Huy Phan	fix for export excel stock code was changed to date if have date format
113.    20241101        ThanhHung       fix export excel show format date (TSK-29076)
114.    20241112        NghiaLv         Fix export excel show format date fr_sal_per_comm for RHS - (TSK-NA)
115.	20241226	Yan		add fromwhatsappproc
116.	20250113	TranTin		add export XML for TNO (TSK-29419)
117.	20250131	Atikah		enhance ExportCSV_cross() to be able to display two header for YonMing - TSK-28499
118.	20250204	Phat		add fr_yearly_pyrl_with_allow for exclude_pageload_js_check_list - Shinfox  - TSK-29545
119.    20250217   	ThanhHung   	Add logic set utf16 for Matten (TSK-29588)
120.    20250225    	ThanhHung   	Add more report to set utf16 for Matten (TSK-29588)
121.	20250313	Phat		add logic remove table ytd_table for fr_leave_detail_2-Hentick-TSK-29713
122.    20250424   	Huy Phan   	Added logic to check user access to export report is_dont_allow_export_report (By Ming)
123.    20250424   	Huy Phan   	Get is_dont_allow_export_report from inc_set_privi_access instead of inc_g3c_user_access
124.	20250627	ThanhNgo	Add fr_grp_proj_appr_form_rpt,fr_grp_gm_by_staff_proj to exclude_pageload_js_check_list for welltech TSK-30178
125.	20250815	WeiJun  	Add tno_report_table_function for TNO(TSK-NA)
126.	20250819	DingYong	tno_report_table_function only m8
127.	20250822	DingYong	release tno_report_table_function for all
128.	20250826	WeiJun  	Add AI Chart for TNO(TSK-NA)
129.	20250904	ruc		enhance for fr_peppol_doc_list
129.	20250917	WeiJun  	Enhance AI Chart for TNO(TSK-NA)
##################################################################################################################### --->
<!--- fnm: inc_report_main_heading.cfm --->
<cfoutput>
<cfparam name = "bdtk" default = "0">
<!---<cfset setexcelborder = bdtk>--->
<cfparam name="setexcelborder" default="0">
<cfparam name="papersize_width" default="750">
<cfparam name="no_excel_rpt_list" default="">
<cfparam  name="vle_remove_image_excel_yn" default="y">
<cfparam  name="vle_remove_footer_layer_excel_yn" default="n">
<cfparam name="StyleShtUIVersion" default="e">

<cfset debug_color_yn = "n">
<cfset bgcolor01 = "white">
<cfset bgcolor02 = "white">
<cfset bgcolor03 = "white">

<cfif StyleShtUIVersion is "i" or StyleShtUIVersion is "I">
	<cfset bgcolor04 = "##eef2fc">
	<cfset bgcolor05 = "##eef2fc">
<cfelse>
	<cfset bgcolor04 = "white">
	<cfset bgcolor05 = "white">
</cfif>
<cfset bgcolor06 = "white">
<cfset bgcolor07 = "white">
<cfset layer_bgcolor = "white">
<cfif debug_color_yn EQ "y">
	<cfset bgcolor01 = "yellow">
	<cfset bgcolor02 = "pink">
	<cfset bgcolor03 = "lightyellow">
	<cfset bgcolor04 = "lightgreen">
	<cfset bgcolor05 = "green">
	<cfset bgcolor06 = "lightblue">
	<cfset bgcolor07 = "aqua">
	<cfset layer_bgcolor = "yellow">
</cfif>

<cfparam name="fntcalib_redefine_yn" default="n">
<cfif fntcalib_redefine_yn eq "y">
	<style>
		.fntcalib14{ font-family: #font_family#; font-size: #pt_fntcalib14#pt;}
		.fntcalib16{ font-family: #font_family#; font-size: #pt_fntcalib16#pt;}
		.fntcalib18{ font-family: #font_family#; font-size: #pt_fntcalib18#pt;}
	</style>
</cfif>
	
	<cfparam name="pagebreak_method_new" default="n">
	<cfparam name="marg_left" default="5">
	<cfparam name="marg_right" default="5">
	<cfparam name="can_new_yn" default="y">
	<cfparam name="can_print_yn" default="y">
	<cfparam name="can_excel_yn" default="y">
	<cfparam name="can_csv_yn" default="y">
	<cfparam name="multi_type" default="">
	<cfparam name="cntnum_entity" default="1">
	<cfparam name="chg_entity_yn" default="n">
	<cfparam name="chg_lang_yn" default="y">
	<cfparam name="subscribed_lang_cnt" default="0">
	<cfparam name="rptmainbar_exist_yn" default="n">
	<cfparam name="fromreport" default="">
	<cfparam name="fromemailproc" default="n">
	<cfparam name="fromwhatsappproc" default="n">
	<cfparam name="is_cloud_hosting_yn" default="n">
	<cfparam name="show_table_function_yn" default="y">
	<cfset wd_hd_inner = papersize_width - (marg_left + marg_right)>

	<Cfset export_to_csv_all_page = "n">
	<CFif listfind("hrm_pymnt_detail_rpt,fr_proj_bud_ytd_pbud_cost,fr_fin_ar_soa,fr_fin_debtor,fr_yearly_pyrl_by_staff,hrm_payrl_ear_wk_rpt",fromreport)>
		<Cfset export_to_csv_all_page = "y">
	</CFif>
	
	<Cfset exclude_pageload_js_check_yn = "n">
	<cfset exclude_pageload_js_check_list = "fr_pr_export,fr_pbud_export,fr_so_export,fr_do_export,fr_ne_transaction_export,fr_stk_master_export,fr_stk_clas_export,fr_shipment_asn_export,fr_sal_inv_export,fr_so_commit_date_export,fr_bom_export,fr_po_export,fr_so_po_export,fr_ne_stock_export,fr_fin_pl_yoy_by_prd,fr_fin_pl_by_prd,fr_dem_plan,fr_yearly_pyrl_by_staff,fr_payroll_payslip_rpt,hrm_payrl_ear_wk_rpt,fr_yearly_pyrl_with_allow,fr_grp_proj_appr_form_rpt,fr_grp_gm_by_staff_proj">
	<cfif listfind(exclude_pageload_js_check_list,fromreport) GT 0>
		<Cfset exclude_pageload_js_check_yn = "y">
	</cfif>

	<cfif fromemailproc EQ 'y' or fromwhatsappproc EQ 'y'>
	<cfelse>
		<cfset rptmainbar_exist_yn = "y">
		<cfif multi_type neq "multi_format">
			<style>
				.bgnone {BACKGROUND-COLOR: transparent;}
				.titleblock_botm    {  BACKGROUND-COLOR: ##eeedd7; border-bottom: 0px solid ##a8a8a8; border-right: 0px solid ##a8a8a8; font-family: Calibri; font-size: 10pt ; font-weight: bold;}
				.boxstyle_hdr {BACKGROUND-COLOR: ##13588c; padding: 0px 12px 0px 12px; text-transform:uppercase; box-shadow:1px 1px 4px 0px ##8d8d8d; text-shadow:0px 0px ##111111; font-weight: bold; color:##ffffff; border: 0px solid ##8badbc; border-radius:2px; font-family: Calibri; font-size: 9pt; letter-spacing:2px; height:23px }
				.boxstyle_hdr:hover {BACKGROUND-COLOR: ##b41515; padding: 0px 12px 0px 12px; text-transform:uppercase; box-shadow:1px 2px 4px 0px ##777777; text-shadow:0px 0px ##222222; font-weight: bold; color:##ffffff; border: 0px solid ##8badbc; border-radius:2px; font-family: Calibri; font-size: 9pt; letter-spacing:2px; height:23px }
				.boxstyle_hdr2 { background-image:url(../../folder_graphics/#fldrgraphic#/Grad_MetBlue_Revr.gif); font-weight: bold; color:##4d7e8c; border-bottom: 1 solid ##aaaaaa; border-top: 1 solid ##ffffff; border-right: 1 solid ##aaaaaa; border-left: 1 solid ##ffffff; font-family: Calibri; font-size: 10pt }
				.pagebreak_bf { page-break-before: always;}
				.pagebreak_af { page-break-after: always;}
				.fontblack0a{ font-family: Arial; font-size: 0pt;}
				.fontblack8a{font-family: Arial; font-size: 8pt }
				.fontblack9a{font-family: Arial; font-size: 9pt }
				.None_Excel_Disp{display:none}                  
			</style>
		<cfelse>
			<style>
				.bgnone {BACKGROUND-COLOR: transparent;}
				.titleblock_botm    {  BACKGROUND-COLOR: ##eeedd7; border-bottom: 0px solid ##a8a8a8; border-right: 0px solid ##a8a8a8; font-family: Calibri; font-size: 10pt ; font-weight: bold;}
				.boxstyle_hdr {BACKGROUND-COLOR: ##051d3e; padding: 0px 12px 0px 12px; text-transform:uppercase; box-shadow:1px 1px 4px 0px ##8d8d8d; text-shadow:0px 0px ##111111; font-weight: bold; color:red; border: 0px solid ##8badbc; border-radius:2px; font-family: Calibri; font-size: 9pt; letter-spacing:2px; height:23px }
				.boxstyle_hdr:hover {BACKGROUND-COLOR: ##b41515; padding: 0px 12px 0px 12px; text-transform:uppercase; box-shadow:1px 2px 4px 0px ##777777; text-shadow:0px 0px ##222222; font-weight: bold; color:black; border: 0px solid ##8badbc; border-radius:2px; font-family: Calibri; font-size: 9pt; letter-spacing:2px; height:23px }
				.boxstyle_hdr2 { background-image:url(../../folder_graphics/#fldrgraphic#/Grad_MetBlue_Revr.gif); font-weight: bold; color:##4d7e8c; border-bottom: 1 solid ##aaaaaa; border-top: 1 solid ##ffffff; border-right: 1 solid ##aaaaaa; border-left: 1 solid ##ffffff; font-family: Calibri; font-size: 10pt }
				.pagebreak_bf { page-break-before: always;}
				.pagebreak_af { page-break-after: always;}
				.fontblack0a{ font-family: Arial; font-size: 0pt;}
				.fontblack8a{font-family: Arial; font-size: 8pt }
				.fontblack9a{font-family: Arial; font-size: 9pt }
				.None_Excel_Disp{display:none}
			</style>
		</cfif>

		<cfif fromreport EQ "fr_fin_pl" or fromreport EQ "fr_fin_pl_summ">
			<cfset chg_entity_yn = "y">
		</cfif>
		<cfif fromreport EQ "fr_fin_bs" or fromreport EQ "fr_fin_bs2" or fromreport EQ "fr_fin_tb">
			<cfset chg_entity_yn = "y">
		</cfif>
		<cfif fromreport EQ "fr_fin_ar" or fromreport EQ "fr_fin_ar_td" or fromreport EQ "fr_fin_age_ar" or fromreport EQ "fr_fin_age_arap" or fromreport EQ "fr_fin_age_ar_dtl" or fromreport EQ "fr_ar_bal" or fromreport EQ "fr_ar_ccy" or fromreport EQ "fr_fin_ar_prj">
			<cfset chg_entity_yn = "y">
		</cfif>
		<cfif fromreport EQ "fr_fin_ap" or fromreport EQ "fr_fin_ap_td" or fromreport EQ "fr_fin_ap_due"  or fromreport EQ "fr_fin_ar_due" or fromreport EQ "fr_fin_age_ap" or fromreport EQ "fr_ap_bal" or fromreport EQ "fr_ap_ccy">
			<cfset chg_entity_yn = "y">
		</cfif>
		<cfif fromreport EQ "fr_pur_inv_rpt">
			<cfset chg_entity_yn = "y">
		</cfif>
		<cfif fromreport EQ "fr_sub_jour">
			<cfset chg_entity_yn = "y">
		</cfif>
		<cfif fromreport EQ "fr_gst_vat">
			<cfset chg_entity_yn = "y">
		</cfif>
		<cfif fromsegm EQ "posting_check">
			<cfset chg_entity_yn = "y">
			<cfset can_print_yn = "n">
			<cfset can_excel_yn = "n">
		</cfif>
		<cfif fromreport EQ "fr_stk_bal" or fromreport EQ "fr_stk_move" or fromreport EQ "fr_stk_val">
			<cfset chg_entity_yn = "y">
		</cfif>

		<cfif multi_report_func_yn is "y" and report_auto_submit_yn is "y">
			<cfset chg_entity_yn = "n">
			<cfset chg_lang_yn = "n">
			<cfset can_new_yn = "n">
		</cfif>

		<cfif isDefined('fromreport') and fromreport is 'fr_peppol_doc_list'>
			<cfset chg_lang_yn = "n">
			<cfset show_table_function_yn = 'n'>
			<cfset can_print_yn = 'n'>
		</cfif>

		<cfparam name="default_font" default="fontblack8a">
		<cfparam name="font0" default="fontblack0a">
		<cfset excelNoneDisplayClass = "None_Excel_Disp">
		<cfset flgusebutton = 'n'>
		<cfif StyleShtUIVersion eq "" or StyleShtUIVersion eq "a" or StyleShtUIVersion eq "A" or StyleShtUIVersion eq "b" or StyleShtUIVersion eq "B" or StyleShtUIVersion eq "c" or StyleShtUIVersion eq "C" or StyleShtUIVersion eq "d" or StyleShtUIVersion eq "D">
		<cfelse>
			<cfset flgusebutton = 'y'>
		</cfif>

		<cfparam name="form.UNIQUENUM_PRI" default="na">
		<!--- runing number for salary voucher and payslip--->
		<cfparam name="fmt_num" default="">
		<cfparam name="fmt_num_defult" default="999">
		<cfset active_fmt_yn='n'>
		<cfset active_pwl_yn='n'>

		<cfif cookie.cookmfnunique EQ "alricmfn">
			<cfif listfind("fr_salary_voucher,fr_payroll_payslip_rpt",fromreport) GT 0>
				<cfset active_pwl_yn='y'>
			</cfif>
		<cfelse>
			<CFIF cookie.COOKUSERLOGINID is 'm8'>
				<cfif listfind("fr_salary_voucher,fr_payroll_payslip_rpt,fr_payslip_wrkr,fr_salary_voucher_w",fromreport)>
					<cfset active_fmt_yn='y'>
					<cfset active_pwl_yn='y'>
				</cfif>

				<CFIF ListFind("ess_gen_payslip,ess_payslip", fromsegm)>	<cfset active_fmt_yn='y'>	</CFIF>
			</CFIF>
		</cfif>

		<cfquery datasource="#cookie.cooksql_mainsync#_active" name="qs_result_deflt_number">
			SELECT	*
			FROM 	set_co_data
			WHERE	companyfn = <cfqueryparam  value="#cookie.cookcfnunique#"  cfsqltype="cf_sql_varchar">
				AND tag_table_usage = <cfqueryparam  value="co_main"  cfsqltype="cf_sql_varchar">
		</cfquery>
		<cfloop query="qs_result_deflt_number">
			<cfset bm_viewform_option_oth05_salaryvoucher = #mid(viewform_option_oth05,52,3)#>
			<cfset bm_viewform_option_oth05_payslip = #mid(viewform_option_oth05,55,3)#>
			<cfif systemset_yn01 EQ "nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn">
				<cfset bm_systemset_yn01_salary_voucher="letterhead_logo.gif">
			<cfelse>
				<cfset bm_systemset_yn01_salary_voucher="#systemset_yn01#">
			</cfif>
			<cfif systemset_yn02 EQ "nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn">
				<cfset bm_systemset_yn02_payslip="letterhead_logo.gif">
			<cfelse>
				<cfset bm_systemset_yn02_payslip="#systemset_yn02#">
			</cfif>
		</cfloop>
		<cfif bm_viewform_option_oth05_salaryvoucher LE 0>
			<cfset bm_viewform_option_oth05_salaryvoucher = "999">
		</cfif>
		<cfif bm_viewform_option_oth05_payslip LE 0>
			<cfset bm_viewform_option_oth05_payslip = "999">
		</cfif>

		<CFIF ListFind("fr_salary_voucher,fr_salary_voucher_w", fromreport)>
			<cfset fmt_num_defult=bm_viewform_option_oth05_salaryvoucher>
			<Cfset letterhead_logo= bm_systemset_yn01_salary_voucher>
		<CFELSEIF
			ListFind("fr_payroll_payslip_rpt,fr_payslip_wrkr", fromreport) or
			ListFind("ess_gen_payslip,ess_payslip", fromsegm)
		>
			<cfset fmt_num_defult=bm_viewform_option_oth05_payslip>
			<Cfset letterhead_logo= bm_systemset_yn02_payslip>
		</CFIF>
		
		<cfset can_csv_yn = "n">
		<cfif can_excel_yn is "y">
			<cfset can_csv_yn = "y">
		</cfif>
		
		<cfif listfind(no_excel_rpt_list,fromreport) GT 0>
			<cfset can_excel_yn = "n">
		</cfif>

		<cfparam name="from_autoemail" default="n">

		<!--- end runing number for salary voucher and payslip--->
		<cfif multi_type neq "multi_format" and from_autoemail neq 'y'>
			<table bgcolor="#bgcolor04#" id="headmain"  border="#setexcelborder#" width="100%" class="bgnone" cellspacing="0" cellpadding="0">
				<tr bgcolor="#bgcolor05#" height="29" valign="bottom">
					<td nowrap width="100%" align="right" class="bgnone">
						<span style="position:relative;">
						<cfif active_fmt_yn EQ "y">
							<cfset prn_view_form = listlast(cgi.script_name,"/")>
							<cfset vle_QUERY_STRING = CGI.QUERY_STRING>
							<cfset vle_QUERY_STRING = replace(vle_QUERY_STRING,"&fmt_num=#fmt_num#","","all")>
							<cfset url_string_std = "#prn_view_form#?#vle_QUERY_STRING#">

							&nbsp;<input type="button" class="boxstyle_hdr" name="active_fmt_yn" size="6" align="middle" value="FMT" title="FMT" onClick="javascript:activeFmtClick()">
							<select name='format_list' id="format_list" size='20'  class="fontblack8v" style='display:none;font-family:Arial;top:25;left:5;position:absolute;background-color:##cfe3a6;border-color:black;padding:0px;background-color:##cfe3a6;border-color:black;width:120px'
								onChange="ChangeFormat(this);return false;" onBlur="this.style.display='none'">
								<option value="">&nbsp;&nbsp;&nbsp;&nbsp;</option>
								<option value="#url_string_std#&fmt_num=#fmt_num_defult#">Format Default&nbsp;</option>
								<cfset searchdirectory = "#syspathname_mapdrive#v50stringadmin\v50master\contentadmin">
								<cfset searchfor="inc_report_"& fromreport & "_">
								<cfif fromreport is "fr_salary_voucher_w">
									<cfset searchfor="inc_report_fr_payroll_voucher_rpt_">
								<cfelseif fromreport is "fr_payslip_wrkr">
									<cfset searchfor="inc_report_fr_payroll_payslip_rpt_">
								<CFELSEIF ListFind("ess_gen_payslip,ess_payslip", fromsegm)>
									<cfset searchfor="inc_report_fr_payroll_payslip_rpt_">
								</cfif>
								<cfif DirectoryExists("#searchdirectory#")>
									<cfdirectory action="list" sort="asc" name="fmtdirectory" filter="#searchfor#???.cfm"  listinfo="name" directory="#searchdirectory#">
									<cfloop query="fmtdirectory">
										<cfsavecontent  variable="filnameorig">
											#name#
										</cfsavecontent>

										<cfset fmt_number =replace(name,"#searchfor#","","all")>
										<cfset fmt_number =replace(fmt_number,".cfm","","all")>
										<cfset temp =true />

										<cfif ListFind("fr_payroll_payslip_rpt,fr_payslip_wrkr,fr_salary_voucher,fr_salary_voucher_w" ,fromreport) >
											<cfif ListFind("990,991,992,993" ,fmt_number) >
												<cfset temp =false />

												<cfif LCase(payroll_country_code_val) eq "sg" and fmt_number eq 990>		<cfset temp =true />
												<cfelseif LCase(payroll_country_code_val) eq "hk" and fmt_number eq 991>	<cfset temp =true />
												<cfelseif LCase(payroll_country_code_val) eq "vn" and fmt_number eq 992>	<cfset temp =true />
												<cfelseif LCase(payroll_country_code_val) eq "cn" and fmt_number eq 993>	<cfset temp =true />
												</cfif>
											</cfif>
										</cfif>


										<cfif temp eq true >
											<option value="#url_string_std#&fmt_num=#fmt_number#">Format #fmt_number#&nbsp;</option>
										</cfif>

									</cfloop>
								</cfif>

							</select>
						</cfif>
						</span>
						<cfif active_pwl_yn EQ "y">
							&nbsp;<input type="button" class="boxstyle_hdr" name="active_pwl_yn" size="6" align="middle" value="PWL" title="PWL" onClick="javascript:activePwlClick()">
						</cfif>

						<cfif listFind('fr_vat_dec_vn_rpt', fromreport)>
							&nbsp;<input type="button" class="boxstyle_hdr" name="excelBtn" size="6" align="middle" value="XML" title="<cfif set_language is 'english'>Export To</cfif> XML" onClick="javascript:exportXML()">
						</cfif>

						<cfif fromreport neq 'fr_stk_take' AND fromsegm NEQ "imp_do_data">
							<cfif isdefined("fromreport") and scrollcotopmain_yn is 'y'>
								<cfinclude template="inc_get_lang_list.cfm">
								<cfinclude template="inc_cmp_change_wiz.cfm">
								<!---
								&nbsp;<input type="button" class="boxstyle_hdr2" name="QRptBtn" size="5" align="middle" value="<cfif set_language is 'english'>Quick Reports</cfif>" title="<cfif set_language is 'english'>Quick Run Reports</cfif>">
								--->
								<cfinclude template="inc_get_ent_adv_src_option.cfm"><cfif ent_adv_src_yn eq 'y'><cfset chg_entity_yn = 'n'></cfif>
								<cfif left(cookie.cookentproj,3) is "ns_">
									<cfif cntnum_entity GT 1>
										<cfif chg_entity_yn EQ "y">
											<cfif flgUseButton eq "y">
												&nbsp;<input type="button" class="boxstyle_hdr" name="excelBtn" size="6" align="middle" value="<cfif set_language is 'english'>Entity</cfif>" title="<cfif set_language is 'english'>Change Entity</cfif>" onClick="javascript:SelectComp(this)">
											<cfelse>
												&nbsp;&nbsp;<a href="javascript:SelectComp(this)" name="excelBtn" ><img title="<cfif set_language is 'english'>Entity</cfif>" style="cursor:hand" src="../../folder_graphics/#fldrgraphic#/img_excellogo.gif" title="" border=0></a>
											</cfif>
										</cfif>
									</cfif>
								</cfif>
							</cfif>
							<cfif left(cookie.cookentproj,3) is "ns_">
								<cfif subscribed_lang_cnt gt 1>
									<cfif chg_lang_yn EQ "y">
										<cfif flgUseButton eq "y">
											&nbsp;<input type="button" class="boxstyle_hdr" name="excelBtn" size="6" align="middle" value="<cfif set_language is 'english'>Language</cfif>" title="<cfif set_language is 'english'>Change Language</cfif>" onClick="javascript:SelectLang(this)">
										<cfelse>
											&nbsp;&nbsp;<a name="excelBtn" href="javascript:SelectLang(this)"><img title="<cfif set_language is 'english'>Language</cfif>" style="cursor:hand" src="../../folder_graphics/#fldrgraphic#/img_excellogo.gif" title="" border=0></a>
										</cfif>
									</cfif>
								</cfif>
							</cfif>
						</cfif>
						
						<!--- 20250815 [start] tno_report_table_function --->
						<cfif show_table_function_yn EQ "y">
							<input id="applyReportEnhancer" type="button" class="boxstyle_hdr" name="tno_report_table_function" size="6" align="middle" value="<cfif set_language is 'english'>Table Function</cfif>" title="<cfif set_language is 'english'>Table Function</cfif>">
						</cfif>
						<!--- 20250815 [start] tno_report_table_function --->

						<!--- 20250826 [start] AI Chart --->
						<cfif cookie.cookuserloginid is 'm8'>
							<cfif isdefined("fromreport") and (isdefined("rept_oup_code") or isdefined("rpt_format_code")) AND is_dont_allow_export_report NEQ "y" and fromreport neq 'fr_peppol_doc_list'>
								<cfif can_excel_yn EQ "y">
									<cfif flgUseButton eq "y">
										&nbsp;<input id="openAiTableBtn" type="button" class="boxstyle_hdr" name="excelBtn" size="6" align="middle" value="<cfif set_language is 'english'>AI Chart</cfif>" title="<cfif set_language is 'english'>AI Chart</cfif>" onClick="javascript:void(0);">
									<cfelse>
										&nbsp;&nbsp;<a id="openAiTableBtn" name="excelBtn" href="javascript:void(0);"><img title="<cfif set_language is 'english'>AI Chart</cfif>" style="cursor:hand" src="../../folder_graphics/#fldrgraphic#/img_excellogo.gif" title="" border=0></a>
									</cfif>
									
									<textarea style="display:none;" class="csv_raw_table"></textarea>
									<textarea style="display:none;" class="csv_converted_long_format"></textarea>
								</cfif>
							</cfif>
						</cfif>
						<!--- 20250826 [end  ] AI Chart --->

						<!---om 20130305 for New button shown in inc_report_main_heading.cfm--->
						<cfif can_new_yn EQ "y">
							<cfif flgUseButton neq "y">
							<cfelse>
								<cfif isdefined("fromreport")>
									<cfquery datasource="#cookie.cooksql_mainsync#_active" name="qs_topmain_new" maxrows="1">
										select	notes_memo as url_link
										from 	set_fyear_all
										where 	tag_table_usage='topmain_new'
											AND masterfn = <cfqueryparam  value="#cookie.cookmfnunique#"  cfsqltype="cf_sql_varchar">
											AND var_50_001 = <cfqueryparam  value="#fromreport#"  cfsqltype="cf_sql_varchar">
											AND var_50_002 = <cfqueryparam  value="#fromtrans#"  cfsqltype="cf_sql_varchar">
									</cfquery>
									<cfloop query="qs_topmain_new">
										&nbsp;<input type="button" class="boxstyle_hdr" name="newBtn" size="6" align="middle" value="<cfif set_language is 'english'>New<!---@ TTRLN Create @---></cfif>" title="<cfif set_language is 'english'>New<!---@ TTRLN Create @---></cfif>" onClick="window.open('#url_link#','botmain')">
									</cfloop>
								</cfif>
							</cfif>
						</cfif>
						<!---om 20130305 for New button shown in inc_report_main_heading.cfm--->

						<cfif flgUseButton neq "y">
							<cfif can_print_yn EQ "y">
								&nbsp;&nbsp;<a href="javascript:printClick()"><img title="<cfif set_language is 'english'>Print</cfif>" style="cursor:hand" src="../../folder_graphics/#fldrgraphic#/img_printer.gif" border=0></a>
								<cfif len(fromreport) gt 5>
									&nbsp;&nbsp;<a href="javascript:showPrintPreview()"><img title="<cfif set_language is 'english'>Preview</cfif>" style="cursor:hand" src="../../folder_graphics/#fldrgraphic#/img_preview.gif" border=0></a>
								</cfif>
							</cfif>
							&nbsp;&nbsp;&nbsp;<a name="saveBtn" href="javascript:save()"><img title="<cfif set_language is 'english'>Save<!---@ TTRLN BUTTONS @---></cfif>" border="0" src="../../folder_graphics/#fldrgraphic#/img_save.gif"></a>
						<cfelse>
							<cfif can_print_yn EQ "y">
								&nbsp;<input type="button" class="boxstyle_hdr" name="printBtn" size="6" align="middle" value="<cfif set_language is 'english'>Print</cfif>" title="<cfif set_language is 'english'>Print</cfif>" onClick="javascript:printClick()">
								<cfif len(fromreport) gt 5 OR fromsegm EQ "imp_do_data">
									&nbsp;<input type="button" class="boxstyle_hdr" name="printPreviewBtn" size="6" align="middle" value="<cfif set_language is 'english'>Preview</cfif>" title="<cfif set_language is 'english'>Preview</cfif>" onClick="javascript:showPrintPreview()">
								</cfif>
							</cfif>
						</cfif>

						<cfif isdefined("fromreport") and (isdefined("rept_oup_code") or isdefined("rpt_format_code")) AND is_dont_allow_export_report NEQ "y">
							<cfif can_excel_yn EQ "y">
								<cfif flgUseButton eq "y">
									&nbsp;<input type="button" class="boxstyle_hdr" name="excelBtn" size="6" align="middle" value="<cfif set_language is 'english'>Excel</cfif>" title="<cfif set_language is 'english'>Export To Excel</cfif>" onClick="javascript:ExportExcel()">
								<cfelse>
									&nbsp;&nbsp;<a name="excelBtn" href="javascript:ExportExcel()"><img title="<cfif set_language is 'english'>Excel</cfif>" style="cursor:hand" src="../../folder_graphics/#fldrgraphic#/img_excellogo.gif" title="" border=0></a>
								</cfif>
							</cfif>
						</cfif>
						
						<cfif isdefined("fromreport") and (isdefined("rept_oup_code") or isdefined("rpt_format_code")) AND is_dont_allow_export_report NEQ "y">
							<cfif can_csv_yn EQ "y" and rpt_format_code neq "excel" and (rpt_format_code neq "printer" OR (rpt_format_code eq "printer" AND cookie.cookmfnunique eq "uxtramfn"))>
								<cfif flgUseButton eq "y">
									&nbsp;<input type="button" class="boxstyle_hdr" name="excelBtn" size="6" align="middle" value="CSV" title="<cfif set_language is 'english'>Export To CSV</cfif>" onClick="javascript:ExportCSV()">
								<cfelse>
									&nbsp;&nbsp;<a name="excelBtn" href="javascript:ExportCSV()"><img title="CSV" style="cursor:hand" src="../../folder_graphics/#fldrgraphic#/img_csvlogo.gif" title="" border=0></a>
								</cfif>
							</cfif>
						</cfif>
						&nbsp;
					</td>
				</tr>
			</table>
		</cfif>


		<SCRIPT LANGUAGE="JavaScript" TYPE="text/javascript">
		<!--
			var orig_frmbody1="";
			var inner_value_head="";

			function SelectComp(btn)
			{
				document.all.lstComp.style.left =getRealLeft(btn);
				//document.all.lstComp.style.top = getRealTop(btn) + 20;
				document.all.lstComp.style.top = getRealTop(btn) + 20 - document.body.scrollTop;
				document.all.lstComp.style.display="block";
				document.all.lstComp.focus();
			}

			function SelectLang(btn)
			{
				document.all.lstLang.style.left =  getRealLeft(btn);
				document.all.lstLang.style.top = getRealTop(btn) + 20 - document.body.scrollTop;
				document.all.lstLang.style.display="block";
				document.all.lstLang.focus();

			}

			function empty_anchor(){
				obj_anchor = document.getElementsByTagName("a");
				for (i = 0; i <= obj_anchor.length; i++){
					if(obj_anchor[i] != null){
						obj_anchor[i].removeAttribute("href");
						obj_anchor[i].removeAttribute("name");
					}
				}
			}
			function empty_select()
			{
				cntntfinal = document.all.pg_content.value;
				selc = eval('document.all.lstComp');

				if (selc != null)
				{
					selchtml = selc.outerHTML;
					cntntfinal = cntntfinal.replace(selchtml,"");
				}
				sell = eval('document.all.lstLang');
				if (sell != null)
				{
					sellhtml = sell.outerHTML;
					cntntfinal = cntntfinal.replace(sellhtml,"");
				}
				document.all.pg_content.value = cntntfinal;

			}
			function empty_image(){
				obj_image = document.getElementsByTagName("img");
				for (i = 0; i <= obj_image.length; i++){
					if(obj_image[i] != null){
						obj_image[i].removeAttribute("src");
						obj_image[i].removeAttribute("alt");
						obj_image[i].removeAttribute("align");
						obj_image[i].removeAttribute("border");
						obj_image[i].removeAttribute("style");
						obj_image[i].removeAttribute("name");
						obj_image[i].removeAttribute("onclick");
						obj_image[i].removeAttribute("height");
						obj_image[i].removeAttribute("width");
					}
					//if(typeof obj_image[i] == "object" && typeof (obj_image[i].parentNode) == "object")
					//	(obj_image[i].parentNode).removeChild(obj_image[i]);
				}
			}

			function emptyDiv() {
				<cfif listFind("fr_grp_wage_type_variance,fr_wage_type_variance_rpt", fromreport) gt 0>
					var aIdsToRemove = ['popup_head_count'];
				<cfelseif listFind("fr_prj_s_curve", fromreport) gt 0>
					var aIdsToRemove = ['prn_div_replace'];
				</cfif>
				if (aIdsToRemove.length) {
					for (let i = 0; i < aIdsToRemove.length; i++) {
						let tempVar = document.getElementById(aIdsToRemove[i]);
						if (tempVar) {
							tempVar.parentNode.removeChild(tempVar);
						}
					}
				}
			}
			
			function ExportExcel() {
				//<!--- DingYong@20240604 to avoid form not fully load or page loading slow --->
				<cfif exclude_pageload_js_check_yn eq 'n'>
					if(typeof document.all.rept_oup_code == "object" && document.all.rept_oup_code.value =="screen"){
						if(typeof document.all.tag_report_end  != "object"){
							alert('<cfif set_language is 'english'>Page not fully loaded</cfif>.');
							return false;
						}
					}
				</cfif>
				<cfif fromreport EQ "fr_e_invoice_rpt">
					changeFormatDisplay("excel");
				</cfif>

				<cfif fromreport EQ "fr_sal_daily">
					$('form[name="ERPform"] .group_header').each(function(i){
						this.style.color = "black";
					})
				</cfif>
				<cfif fromreport EQ "fr_occ_emp_data">
					changeDisplayExcel();
				</cfif>
				<cfif fromreport EQ "fr_leave_detail_2">
					if (typeof removeExtraTables == "function") {
						removeExtraTables('ytd_table');
					}
				</cfif>
				var totalmb = 0;
				<cfif is_cloud_hosting_yn eq "y">
					var str = document.documentElement.innerHTML;
					var bytes = [];
					for (var i = 0; i < str.length; ++i)
					{
						var charCode = str.charCodeAt(i);
						bytes.push(charCode);
					}
					
					if (bytes.length > 0)
					{
						totalmb = parseInt(Math.floor(bytes.length / 1024) / 1024);
					}
				</cfif>
				<cfif cookie.cookmfnunique EQ "cschold5500129mfn">
					totalmb = 0;
				</cfif>
				if(totalmb <= 10)
				{
					if ($('html').is('.ie6, .ie7, .ie8, .ie9')) {
						ExportExcel_compat();
					} else {
						ExportExcel_cross();
					}
					<cfif fromreport EQ "fr_e_invoice_rpt">
						setTimeout(function(){
			  				changeFormatDisplay("screen");	
			  			}, 500);
					</cfif>
				}
				else
				{
					alert("<cfif set_language is 'english'>Export To Excel Size Exceeded Limit Of 10MB And This Action Is Aborted As It Will Cause System To Slowdown For Other Users. Please Use Export To CSV.</cfif>");
				}

				<cfif fromreport EQ "fr_sal_daily">
					$('form[name="ERPform"] .group_header').each(function(i){
						this.style.color = "white";
					})
				</cfif>
			}


			function ExportExcel_compat() {
				var looplist = ["prn_div", "localstyle_div", "trxscmsetting00_div", "trxsetting01_div"];
				for(var i in looplist){
					if (typeof eval("document.all." + looplist[i]) == "object"){
						var tempClass = eval("document.all." + looplist[i]).className;
						eval("document.all." + looplist[i]).className = "#excelNoneDisplayClass#";
					}
				}
				orig_frmbody1 = document.all.frmbody1.innerHTML;

				empty_nonedisplay();
				empty_anchor();empty_image();
				empty_ifrm();
				empty_select();

				for(var i in looplist){
					if (typeof eval("document.all." + looplist[i]) == "object"){
						eval("document.all." + looplist[i]).style.display = "";
					}
				}

				var vTrBackCover = document.getElementById('tr_tbl_backCover');
				if (vTrBackCover !=null)
					vTrBackCover.style.display='none';

				document.ERPform.action = "report_excel_download.cfm"
				document.ERPform.submit();
				setTimeout("export2('"+tempClass+"')",3000);
			}

			function ExportExcel_cross() {
				if (document.ERPform && document.ERPform.pg_content) {
					var exportStripScripts = function(a,b,c){b=new Option;b.innerHTML=a;for(a=b.getElementsByTagName('script');c=a[0];)c.parentNode.removeChild(c);return b.innerHTML};
					function replaceStrNumber(){
						$('form[name="ERPform"] td').each(function(ind,tdtag){
                                                        <cfif isDefined("fromreport") AND ((fromreport EQ "fr_poc_outsg" AND cookie.cookmfnunique EQ "gskmfn") OR (fromreport EQ "fr_sal_per_comm" AND cookie.cookmfnunique EQ "rhsynergy37465mfn"))>
                                                                if((tdtag.innerText.trim().length == 10 || tdtag.innerText.trim().length == 8) && (tdtag.innerText.trim()[2] == "-" || tdtag.innerText.trim()[2] == "/") && (tdtag.innerText.trim()[5] == "-" || tdtag.innerText.trim()[5] == "/")) {
                                                                        tdtag.setAttribute("style", "mso-number-format:'Short Date';");
                                                                }else if(tdtag.innerText.trim().length > 0 && (tdtag.innerText.trim()[0] == "0" || tdtag.innerText.trim()[tdtag.innerText.trim().length-1] == "0") && tdtag.align == 'left'){
                                                                        tdtag.setAttribute("style", "mso-number-format:'\@';");
                                                                }
                                                        <cfelse>
                                                                if((tdtag.innerText.trim().length == 10 || tdtag.innerText.trim().length == 8) && (tdtag.innerText.trim()[2] == "-" || tdtag.innerText.trim()[2] == "/") && (tdtag.innerText.trim()[5] == "-" || tdtag.innerText.trim()[5] == "/")) {
                                                                        tdtag.setAttribute("style", "mso-number-format:'\@';");
                                                                }
                                                                if(tdtag.innerText.trim().length > 0 && (tdtag.innerText.trim()[0] == "0" || tdtag.innerText.trim()[tdtag.innerText.trim().length-1] == "0") && tdtag.align == 'left')
                                                                {
                                                                        tdtag.setAttribute("style", "mso-number-format:'\@';");
                                                                }                                                                
                                                        </cfif>							
						})
					}
					function clean_for_excel(sMarkup) {
						sMarkup = exportStripScripts(sMarkup);

						var oTemp = document.createElement('div');
						oTemp.style.display = 'none';

						document.body.appendChild(oTemp);
						oTemp.innerHTML = sMarkup;

						<cfif fromreport EQ "fr_dem_plan">//for export excel input column
							var oTempTags = oTemp.getElementsByTagName('input');
							if (oTempTags.length) {
								for (var j = 0; j < oTempTags.length; j++) {
									if (oTempTags[j].type == 'text'){
										oTempTags[j].parentNode.innerHTML = oTempTags[j].value;//replace column factor 
										oTempTags[j].parentNode.innerHTML = oTempTags[j].value;//replace column planning qty
									}
									
								}
							}
						</cfif>
						var aTagsToRemove = ['style', 'select', 'input', 'iframe', 'textarea','link'];
						var aIdsToRemove = ['prn_div_replace'];

						var aRemoveSpooler = [];
						if (aTagsToRemove.length) {
							for (var i = 0; i < aTagsToRemove.length; i++) {
								var oTempTags = oTemp.getElementsByTagName(aTagsToRemove[i]);
								if (oTempTags.length) {
									for (var j = 0; j < oTempTags.length; j++) {
										aRemoveSpooler.push(oTempTags[j]);
									}
								}
							}
						}
						if (aIdsToRemove.length) {
							for (var i = 0; i < aIdsToRemove.length; i++) {
								if (document.getElementById(aIdsToRemove[i])) {
									aRemoveSpooler.push(document.getElementById(aIdsToRemove[i]));
								}
							}
						}
						// remove links
						var oTempLinks = oTemp.getElementsByTagName('a');
						if (oTempLinks.length) {
							for (var i = 0; i < oTempLinks.length; i++) {
								//var sLinkText = $(oTempLinks[i]).text();
								var sLinkText = oTempLinks[i].innerHTML;
								if (sLinkText.length) {
									var oLinkText = document.createElement('span');
									oLinkText.innerHTML = sLinkText;
									oTempLinks[i].parentNode.insertBefore(oLinkText, oTempLinks[i]);
								}
								aRemoveSpooler.push(oTempLinks[i]);
							}
						}
                                                
						<cfif vle_remove_image_excel_yn EQ "y">
                                                        // remove imgs
                                                        var oTempImgs = oTemp.getElementsByTagName('img');
                                                        if (oTempImgs.length) {
                                                                for (var i = 0; i < oTempImgs.length; i++) {
                                                                        var sImgSrc = oTempImgs[i].innerHTML;
                                                                        if (sImgSrc.length) {
                                                                                var oImgSrc = document.createElement('span');
                                                                                oImgSrc.innerHTML = sImgSrc;
                                                                                oTempImgs[i].parentNode.insertBefore(oImgSrc, oTempImgs[i]);
                                                                        }
                                                                        aRemoveSpooler.push(oTempImgs[i]);
                                                                }
                                                        }
                                                <cfelse>
                                                        <cfif vle_remove_footer_layer_excel_yn EQ "y">
                                                                var img_footer_layers = document.all.FooterLayer;
                                                                if (typeof img_footer_layers == "object" && img_footer_layers.length > 0) {
                                                                        for (var i = img_footer_layers.length - 1; i >= 0 ; i--) {
                                                                                if(typeof img_footer_layers[i] == "object"){
                                                                                        img_footer_layers[i].remove();
                                                                                }
                                                                        }
                                                                }
                                                        </cfif>
                                                </cfif>

						if (aRemoveSpooler.length) {
							for (var i = 0; i < aRemoveSpooler.length; i++) {
								if (aRemoveSpooler[i]) {
									aRemoveSpooler[i].parentNode.removeChild(aRemoveSpooler[i]);
								}
							}
						}
						sMarkup = oTemp.innerHTML.replace(/ +(?= )/g,'');
						sMarkup = sMarkup.replace(/”/gi,'"');
						sMarkup = sMarkup.replace(/’/gi,"'");
						oTemp.parentNode.removeChild(oTemp);
						return sMarkup;
					}
					<cfif listFind("fr_prj_s_curve,fr_grp_wage_type_variance,fr_wage_type_variance_rpt", fromreport) gt 0>emptyDiv()</cfif>
					document.ERPform.action = "report_excel_download.cfm";
                                        <cfif cookie.cookmfnunique EQ "matten38747987mfn" AND cookie.cookcfnunique EQ "p24041102323748488">
                                                <cfif listFind("fr_fin_gl_vn,fr_gl_detail_party,fr_ap_age_sum,fr_input_tax_list_vn,fr_ap_age_sum,fr_fin_mul_rpt_vn,fr_fin_gj_vn,fr_trx_dtl_rep", fromreport) GT 0>
                                                        var input_utf16 = document.createElement("input");
                                                        input_utf16.setAttribute("type", "text");
                                                        input_utf16.setAttribute("value", "#fromreport#");
                                                        input_utf16.setAttribute("name", "report_excel_format_utf16");
                                                        document.ERPform.appendChild(input_utf16);
                                                </cfif>
                                        </cfif>
					replaceStrNumber();
					document.ERPform.pg_content.value = clean_for_excel(document.body.innerHTML);
					document.ERPform.submit();
				}
			}

			function ExportCSV() {
				//<!--- DingYong@20240604 to avoid form not fully load or page loading slow --->
				<cfif exclude_pageload_js_check_yn eq 'n'>
					if(typeof document.all.rept_oup_code == "object" && document.all.rept_oup_code.value =="screen"){
						if(typeof document.all.tag_report_end != "object"){
							alert('<cfif set_language is 'english'>Page not fully loaded</cfif>.');
							return false;
						}
					}
				</cfif>
				if ($('html').is('.ie6, .ie7, .ie8, .ie9')) {
					ExportCSV_compat();
				} else {
					ExportCSV_cross();
				}
			}

			function ExportCSV_cross() {
				var oCSVData = {
					columns: [],
					headers: [],
					rows: [],
					row_delimiter: "\r\n",
					col_delimiter: ",",
					header_node: null,
					markup: "",
					title: document.ERPform.pg_header.value
				};

				function get_node_value(oNode) {
					var sValue = '';
					if (document.getElementById('csv-temp-store')) {
						var oTempStore = document.getElementById('csv-temp-store');
						oTempStore.innerHTML = '';
					} else {
						var oTempStore = document.createElement('div');
						document.body.appendChild(oTempStore);

						oTempStore.setAttribute('id', 'csv-temp-store');
						oTempStore.style.display = 'none';
					}
					var sMarkup = oNode.innerHTML;
					
					sMarkup = sMarkup.replace(/\r\n/gi , '');
					sMarkup = sMarkup.replace(/\n/gi , '');
					sMarkup = sMarkup.replace(/\t/gi , '');
					sMarkup = sMarkup.replace(/&nbsp;/gi , ' ');
					sMarkup = sMarkup.replace(/≤/gi , '<=');
					sMarkup = sMarkup.replace(/≥/gi , '>=');
					sMarkup = sMarkup.replace(/<br \/>/gi , ' ');
					sMarkup = sMarkup.replace(/<br>/gi , ' ');
					sMarkup = sMarkup.replace(/ +/gi , ' ');
					sMarkup = sMarkup.replace(/"/gi , '""');
					sMarkup = sMarkup.replace(/”/gi , '""');
					sMarkup = sMarkup.replace(/’/gi , "'");
					console.log(sMarkup);
					sMarkup = $.trim(sMarkup);
					if (sMarkup.length) {
						oTempStore.innerHTML = sMarkup;
						var aTagsToStrip = ['img', 'iframe', 'ul', 'option', 'ol', 'style', 'script', 'select', 'option', 'input', 'textarea'];
						for (var i = 0; i < aTagsToStrip.length; i++) {
							var oRemoveTags = oTempStore.getElementsByTagName(aTagsToStrip[i]);
							if (oRemoveTags.length) {
								for (var j = 0; j < oRemoveTags.length; j++) {
									if (aTagsToStrip[i] == 'select') {
										console.log(oRemoveTags[j].name);
									}
									oRemoveTags[j].parentNode.removeChild(oRemoveTags[j]);
								}
							}
						}						
						sValue = $(oTempStore).text();
						sValue = $.trim(sValue);
						//Lopper: Add Show format 0010 in Export CSV
						if(oNode.classList.contains("showNumberCSV") == true){
							sValue = '=""'+sValue+'""';
						}
					}
					return sValue;
				}

				function get_primary_rows(oNode) {
					var oRows = [];
					var oNodeRows = oNode.getElementsByTagName('tr');
					if (oNodeRows.length) {
						for (var i = 0; i < oNodeRows.length; i++) {
							var bRowLowest = true;
							var bRowHasValues = false;
							var oNodeRowCells = oNodeRows[i].getElementsByTagName('td');
							if (oNodeRowCells.length) {
								for (var j = 0; j < oNodeRowCells.length; j++) {
									if (oNodeRowCells[j].getElementsByTagName('td').length) {
										bRowLowest = false;
										break;
									} else {
										if (!bRowHasValues) {
											if (get_node_value(oNodeRowCells[j]).length ) {
												bRowHasValues = true;
											}
										}
									}
								}
							}
							if (bRowLowest && bRowHasValues) {
								oRows.push(oNodeRows[i]);
							}
						}
					}
					return oRows;
				}

				function get_report_header() {
					var aHeaderRows = [];
					if (document.getElementById('rpt_header_table')) {
						var oHeaderTable = document.getElementById('rpt_header_table')
						var oPrimaryRows = get_primary_rows(oHeaderTable);
						for (var i = 0; i < oPrimaryRows.length; i++) {
							var oPrimaryRowCells = oPrimaryRows[i].getElementsByTagName('td');
							if (oPrimaryRowCells.length) {
								var aRow = [];
								for (var j = 0; j < oPrimaryRowCells.length; j++) {
									var sCellValue = get_node_value(oPrimaryRowCells[j]);
									aRow.push(sCellValue);
									if (i == 1) {
										oCSVData.title = sCellValue;
									}
								}
								aHeaderRows.push(aRow);
							}
						}
					}
					return aHeaderRows;
				}

				function get_table_header() {
					var aCells = [];
					var oMasterNode = null;
					if (document.getElementById('rowheader')) {
						oMasterNode = document.getElementById('rowheader');
					} else {
						// sniff for a header
						if ($('.cell_input_lay_rpt').length) {
							var oReportCells = $('.cell_input_lay_rpt');
							if (oReportCells.length) {
								oMasterNode = oReportCells[0];
							}
						}
						else if($('.cell_input_lay_rpt2').length){
							var oReportCells = $('.cell_input_lay_rpt2');
							if (oReportCells.length) {
								oMasterNode = oReportCells[0];
							}
						}
						else {
						}
					}
					if (oMasterNode) {
						oCSVData.header_node = oMasterNode;
						var oMasterCellRows = get_primary_rows(oMasterNode);
						if (oMasterCellRows.length) {
							for (var i = 0; i < oMasterCellRows.length; i++) {
								var oMasterCellRowCells = oMasterCellRows[i].getElementsByTagName('td');
								
								if (oMasterCellRowCells.length) {
									var rowValues = [];
									
									for (var j = 0; j < oMasterCellRowCells.length; j++) {
										if (oMasterCellRowCells[j].classList.contains('titleblock_tb8a')) {
											var sNodeValue = get_node_value(oMasterCellRowCells[j]);
											rowValues.push(sNodeValue);
										} else {
											// Optional: handle cells with other classes or add additional logic
										}
									}
									
									if (rowValues.length > 0) {
										aCells.push(rowValues);
									}
								}
							}
						}
					}
					return aCells;
				}

				function get_table_rows() {
					var aRows = [];
					var oHeaderParentNode = oCSVData.header_node.parentNode;
					var oHeaderParentNodeRows = get_primary_rows(oHeaderParentNode);
					console.log(oHeaderParentNodeRows);
					if (oHeaderParentNodeRows.length) {
						for (var i = 0; i < oHeaderParentNodeRows.length; i++) {
							var oHeaderParentNodeRowCells = oHeaderParentNodeRows[i].getElementsByTagName('td');
							if (oHeaderParentNodeRowCells.length) {
								var aColValues = [];
								for (var j = 0; j < oHeaderParentNodeRowCells.length; j++) {
									if (oHeaderParentNodeRowCells[j].className != 'titleblock_tb8a') {
										aColValues.push(get_node_value(oHeaderParentNodeRowCells[j]));
									}
								}
								if (aColValues.length) {
									aRows.push(aColValues);
								}
							}
						}
					}
					return aRows;
				}

				function get_data() {
					// store the name of the report
					oCSVData.headers = get_report_header();
					// get the table header
					oCSVData.columns = get_table_header();
					// get the table rows
					oCSVData.rows = get_table_rows();
				}

				function similar_arrays(a1, a2) {
					var bSimilar = true;
					if (a1.length == a2.length) {
						for (var i = 0; i < a1.length; i++) {
							if (a1[i] != a2[i]) {
								bSimilar = false;
								break;
							}
						}
					} else {
						bSimilar = false;
					}
					return bSimilar;
				}

				function get_all_page_data() {
					var oMasterNode = [];
					if ($('.cell_input_lay_rpt').length) {
						var oReportCells = $('.cell_input_lay_rpt');
						if (oReportCells.length) {
							for (var i = 0; i < oReportCells.length; i++) {
								oMasterNode.push(oReportCells[i]);
					 		}
						}
					}
					if($('.cell_input_lay_rpt2').length){
						var oReportCells = $('.cell_input_lay_rpt2');
						if (oReportCells.length) {
							for (var i = 0; i < oReportCells.length; i++) {
								oMasterNode.push(oReportCells[i]);
					 		}
						}
					}
					var aRows = [];
					if (oMasterNode.length) {
						for (var i = 0; i < oMasterNode.length; i++) {
							oCSVData.header_node = oMasterNode[i];
							var oHeaderParentNode = oCSVData.header_node.parentNode;
							var oHeaderParentNodeRows = get_primary_rows(oHeaderParentNode);
							console.log(oHeaderParentNodeRows);
							if (oHeaderParentNodeRows.length) {
								for (var j = 0; j < oHeaderParentNodeRows.length; j++) {
									var oHeaderParentNodeRowCells = oHeaderParentNodeRows[j].getElementsByTagName('td');
									if (oHeaderParentNodeRowCells.length) {
										var aColValues = [];
										for (var x = 0; x < oHeaderParentNodeRowCells.length; x++) {
											if (oHeaderParentNodeRowCells[x].className != 'titleblock_tb8a') {
												aColValues.push(get_node_value(oHeaderParentNodeRowCells[x]));
											}
										}
										if (aColValues.length) {
											aRows.push(aColValues);
										}
									}
								}
							}
					 	}
					}

					oCSVData.rows = aRows;
					
					var sMarkup = '';
					if (oCSVData.rows.length) {
						for (var i = 0; i < oCSVData.rows.length; i++) {
							var bDuplicateRow = false;
							if (oCSVData.headers.length) {
								for (var k = 0; k < oCSVData.headers.length; k++) {
									if (similar_arrays(oCSVData.headers[k], oCSVData.rows[i])) {
										bDuplicateRow = true;
										break;
									}
								}
							}
							if (!bDuplicateRow) {
								var aRowMarkup = [];
								for (var j = 0; j < oCSVData.rows[i].length; j++) {
									aRowMarkup.push('"' + oCSVData.rows[i][j] + '"');
								}
								sMarkup += aRowMarkup.join(oCSVData.col_delimiter) + oCSVData.row_delimiter;
							}
						}
					}
					if (document.ERPform.pg_content) {
						document.ERPform.pg_content.value = sMarkup;
						// store the report title so that it can be generated as the file name
						if (oCSVData.title != "") {
							document.ERPform.pg_header.value = oCSVData.title;
						}
						document.ERPform.pg_header.value = document.ERPform.pg_header.value.replace(/ +/g, " ").replace(/ /g, "_");
						document.ERPform.action = "report_excel_download.cfm?report_type_name=#fromreport#";
						document.ERPform.submit();
					}
				}

				function assemble() {
					<CFif export_to_csv_all_page eq "n">
						get_data();
						var sMarkup = '';
						if (oCSVData.headers.length) {
							for (var i = 0; i < oCSVData.headers.length; i++) {
								var aRowMarkup = [];
								for (var j = 0; j < oCSVData.headers[i].length; j++) {
									aRowMarkup.push(oCSVData.headers[i][j]);
								}
								sMarkup += aRowMarkup.join(oCSVData.col_delimiter) + oCSVData.row_delimiter;
							}
						}
									
						var headerSets = [];

						if (oCSVData.columns.length) {
							for (var i = 0; i < oCSVData.columns.length; i += 2) {
								// Get the current set of headers
								var headerSet = [];
								if (i < oCSVData.columns.length) {
									headerSet.push(oCSVData.columns[i]);
								}
								if (i + 1 < oCSVData.columns.length) {
									headerSet.push(oCSVData.columns[i + 1]);
								}
								headerSets.push(headerSet);
							}
						}

						var headerSetIndex = 0;
						var headersAdded = false; // Track if headers have been added

						if (oCSVData.rows.length) {
							for (var i = 0; i < oCSVData.rows.length; i++) {
								var rowData = (oCSVData.rows[i][0].length > 0 ? oCSVData.rows[i][0] : oCSVData.rows[i]);
								rowData = rowData.toString().trim().replace(/[.,\s]+$/, '');

								// Check if the row starts with "1"
								if (rowData === "1") {
									if (headerSetIndex < headerSets.length) {
										var headerSet = headerSets[headerSetIndex];

										headerSet.forEach(row => {
											var aRowMarkup = row.map(column => column);

											sMarkup += aRowMarkup.join(oCSVData.col_delimiter) + oCSVData.row_delimiter;
										});

										headerSetIndex++;
										headersAdded = true; // Mark headers as added
									}
								}

								var bDuplicateRow = false;
								if (oCSVData.headers.length) {
									for (var k = 0; k < oCSVData.headers.length; k++) {
										if (similar_arrays(oCSVData.headers[k], oCSVData.rows[i])) {
											bDuplicateRow = true;
											break;
										}
									}
								}
								if (!bDuplicateRow) {
									// If no headers were added yet, add the default header set
									if (!headersAdded && headerSets.length > 0) {
										var defaultHeaderSet = headerSets[0];
										defaultHeaderSet.forEach(row => {
											var aRowMarkup = row.map(column => column);
											sMarkup += aRowMarkup.join(oCSVData.col_delimiter) + oCSVData.row_delimiter;
										});
										headersAdded = true;
									}

									var aRowMarkup = [];
									for (var j = 0; j < oCSVData.rows[i].length; j++) {
										aRowMarkup.push('"' + oCSVData.rows[i][j] + '"');
									}
									sMarkup += aRowMarkup.join(oCSVData.col_delimiter) + oCSVData.row_delimiter;
								}
							}
						}
						if (document.ERPform.pg_content) {
							document.ERPform.pg_content.value = sMarkup;
							// store the report title so that it can be generated as the file name
							if (oCSVData.title != "") {
								document.ERPform.pg_header.value = oCSVData.title;
							}
							document.ERPform.pg_header.value = document.ERPform.pg_header.value.replace(/ +/g, " ").replace(/ /g, "_");
							document.ERPform.action = "report_excel_download.cfm?report_type_name=#fromreport#";
							document.ERPform.submit();
						}
					<Cfelse>
						get_all_page_data();
					</cfif>
				}
				assemble();
			}

			function ExportCSV_compat() {

				if (typeof document.all.prn_div == "object"){
					var tempClass = document.all.prn_div.className;
					document.all.prn_div.className = "#excelNoneDisplayClass#";
				}

				orig_frmbody1 = document.all.frmbody1.innerHTML;

				var allheadelement = document.getElementsByName('rpt_header_table_div');
				var headlength = allheadelement.length;

				if(headlength > 1)
				{
					inner_value_head = document.all.rpt_header_table_div.innerHTML;
					inner_value_head = allheadelement[0].innerHTML;
					for(var i = 0; i < headlength; i++)
					{
						allheadelement[i].innerHTML = "";
					}
				}
				else
				{
					inner_value_head = document.all.rpt_header_table_div.innerHTML;
					document.all.rpt_header_table_div.innerHTML = "";
				}

				empty_nonedisplay();

				empty_anchor();empty_image();

				empty_ifrm();

				empty_select();

				StripHTML();

				if (typeof document.all.prn_div == "object"){
					document.getElementById('prn_div').style.display = '';
					var vTrBackCover = document.getElementById('tr_tbl_backCover');
					if (vTrBackCover !=null)
						vTrBackCover.style.display='none';
				}
				document.ERPform.action = "report_excel_download.cfm?report_type_name=#fromreport#"
				document.ERPform.submit();
				setTimeout("export2('"+tempClass+"')",3000);
			}

			function trimMethod(item) {
				item = item.replace(/(^\s*)|(\s*$)/gi,"");
				item = item.replace(/[ ]{2,}/gi," ");
				item = item.replace(/\n /,"\n");
				return item;
			}

			function StripHTML()
			{
			   var tmp = document.createElement("DIV");
			   var tmp2 = document.createElement("DIV");

			   var getContent = document.all.pg_content.value;

			   getContent = getContent.replace(/\^/gi,"");
			   getContent = getContent.replace(/\|/gi,"");

			   getContent = getContent.replace(/<\/TR/gi,"^</TR");
			   getContent = getContent.replace(/<\/TD/gi,"|</TD");

			   getContent = getContent.replace(/<br>/gi," ");

			   tmp.innerHTML = getContent;

			   document.all.pg_content.value = tmp.innerText;

			   var format_text = "";
			   var getFormat_val = document.all.pg_content.value;
			   var getHeading_val = inner_value_head;
			   var format_value_head = getHeading_val.replace(/<br>/gi,"&");

			   tmp2.innerHTML = format_value_head;
			   var get_head = tmp2.innerText;

			   var rowArr_heading = get_head.split('&');
			   for(var h = 0; h < rowArr_heading.length; h++)
			   {
				   var getInnerHeading = rowArr_heading[h];
				   format_text = format_text + '"' + trimMethod(getInnerHeading) + '"';
				   format_text = format_text + "@@@";
			   }

			   var rowArr = getFormat_val.split('^');
			   for(var i = 0; i < rowArr.length; i++)
			   {
				   var getInnerElements = rowArr[i];
				   var colArr = getInnerElements.split('|');
				   for(var v = 0; v < colArr.length; v++)
				   {
					   if(v == colArr.length - 1)
					   {
						   format_text = format_text + '"' + trimMethod(colArr[v]) + '"';
					   }
					   else
					   {
						   format_text = format_text + '"' + trimMethod(colArr[v]) + '"' + ",";
					   }
				   }

				   format_text = format_text + "@@@";
			   }
			   document.all.pg_content.value = format_text;
			}

			function export2(tempClass){
				document.all.frmbody1.innerHTML = orig_frmbody1;
				if (typeof document.all.prn_div == "object"){
					document.all.prn_div.className = tempClass;
					var vTrBackCover = document.getElementById('tr_tbl_backCover');
					if (vTrBackCover !=null)
						vTrBackCover.style.display='';
				}
			}
			function empty_ifrm()
			{
				cntntfinal = document.all.frmbody1.innerHTML;
				if (document.all.frmprog != null)
				{
					document.all.frmprog.style.display="none";
					ifrs = cntntfinal.indexOf("IFRAME");
					ifre = cntntfinal.indexOf("/IFRAME>");
					if (ifrs > 0)
					{
						ifr = cntntfinal.substring(ifrs - 10 ,ifre + 8);

						cntntfinal = document.all.frmbody1.innerHTML.replace(ifr,"");

						lnks = cntntfinal.indexOf("<LINK");
						lnke = cntntfinal.indexOf(">");
						lnk = cntntfinal.substring(lnks - 8 ,lnke + 1);
						cntntfinal = cntntfinal.replace(lnk,"");

						lnks = cntntfinal.indexOf("<LINK");
						lnke = cntntfinal.indexOf(">");
						lnk = cntntfinal.substring(lnks - 8 ,lnke + 1);
						cntntfinal = cntntfinal.replace(lnk,"");

					}
				}

				document.all.pg_content.value = cntntfinal;
			}
			function empty_nonedisplay(){
				var allHTMLTags = document.getElementsByTagName("*");
				var i = 0;
				while (i < allHTMLTags.length){
					if (allHTMLTags[i].className=='#excelNoneDisplayClass#')
					{
						allHTMLTags[i].parentNode.removeChild(allHTMLTags[i]);
					}
					 else
						i++;
				}
			}

			function saveToPDF(fromreport)
			{
				<cfset curr_template=replace(listgetat(CGI.SCRIPT_NAME,listlen(CGI.SCRIPT_NAME,"/"),"/"),".cfm","")>
				<cfif curr_template eq 'fr_gst_f3form_my'>
					if (document.all.pg_content !=null)
					{
						document.all.pg_content.value = document.all.frmbody1.innerHTML;
						document.all.pdfprocessor.src = "trig_pdf_content_save.cfm?pdffilename=#curr_template#"
					}
				</cfif>
			}
			function activeFmtClick()
			{
				document.getElementById('format_list').style.display="block";
				document.getElementById('format_list').focus();

			}
			function ChangeFormat(obj)
			{
				var new_ulr=obj.value;
				if(new_ulr=='')
				{
					new_ulr=location.href;
				}
				document.ERPform.action=new_ulr;
				document.ERPform.submit();
			}
			function activePwlClick()
			{
				if($('.report_heading_id').is(':hidden'))
				{
					$('.report_heading_id').show();
				}
				else
				{
					$('.report_heading_id').hide();
				}
			}

			function showPrintPreview()
			{
				var origHTML = document.getElementById("frmbody1").innerHTML;
				$('a').replaceWith(function() { return $(this).contents(); });

				var yourDOCTYPE = "<!DOCTYPE html>"; // your doctype declaration
				var printPreview = window.open('about:blank', 'print_preview');
				printPreview.focus()
				printPreview.document.write(yourDOCTYPE+"<html><head></head><body id='frmbodyPreview'>"+document.getElementById("frmbody1").innerHTML+"</body></html>");
				var objPrintPreview = '<object id="printPrev" width="0" height="0" classid="CLSID:8856F961-340A-11D0-A96B-00C04FD705A2"></object>';
				printPreview.document.body.insertAdjacentHTML('beforeEnd', objPrintPreview);
				setTimeout(function()
						{
							if(typeof printPreview.document.all['prn_div'] == "object" && printPreview.document.all['prn_div'] !=null)
							{
								printPreview.document.all['prn_div'].style.display = "none";
							}
							if (typeof printPreview.document.all['prn_divc'] == "object"){
								printPreview.document.all['prn_divc'].style.display = 'none';
							}
							printPreview.document.getElementById("printPrev").ExecWB(7, 2);
							printPreview.document.getElementById("printPrev").outerHTML = "";
							document.getElementById("frmbody1").innerHTML = origHTML;
							printPreview.close();
						}, 2000);
			}

			function aExcel() {
			/*
			<!---
				var passparm = "";
				<cfif isdefined("FIELDNAMES")>
					<cfloop index="xfield" list="#FIELDNAMES#">
						<cfif xfield neq "rept_oup_code" and xfield neq "title">
						passparm= passparm +"&#xfield#=#evaluate('#xfield#')#";
						</cfif>
					</cfloop>
				</cfif>
				<cfset len_PATH_INFO = listlen(PATH_INFO,"/")>
				<cfset reportfile = #listgetat(PATH_INFO,len_PATH_INFO,"/")#>
				document.ERPform.action = "#reportfile#?#QUERY_STRING#&rept_oup_code=excel"+passparm;
				document.ERPform.submit();
			--->
			*/
			}
		//-->
		</SCRIPT>

		<SCRIPT LANGUAGE="JavaScript" TYPE="text/javascript">
		<!--
			function printClick()
			{

				if (typeof document.all.prn_div == "object" && document.all.prn_div !=null){
					document.getElementById('prn_div').style.display = 'none';
					var vTrBackCover = document.getElementById('tr_tbl_backCover');
					if (vTrBackCover !=null)
						vTrBackCover.style.display='none';
				}
				if (typeof document.all.prn_divc == "object"){
					document.all['prn_divc'].style.display = 'none';
				}
				document.all.frmbody1.className='BODY_view';
				saveToPDF();
				if(navigator.userAgent.toLowerCase().indexOf("firefox")!=-1){
					 window.print();
				    }else{
					document.execCommand('print', false, null);
				    }
				setTimeout(updiv,3000);

			}

			function updiv()
			{
				if (typeof document.all.prn_div == "object" && document.all.prn_div !=null){
					document.getElementById('prn_div').style.display = '';
					var vTrBackCover = document.getElementById('tr_tbl_backCover');
					if (vTrBackCover !=null)
						vTrBackCover.style.display='';
				}
				document.all.frmbody1.className='';

			}
		//-->
		</SCRIPT>
		
		<!--- 20250815 [start] tno_report_table_function --->
		<cfset mode = "realtime"> <!--- change to "daily" or "realtime" --->
		
		<cfif mode EQ "daily">
			<cfset versionParam = dateFormat(now(), "yyyymmdd")>
		<cfelseif mode EQ "realtime">
			<cfset versionParam = dateFormat(now(), "yyyymmdd") & timeFormat(now(), "HHmmss")>
		</cfif>
		
		<script language="JavaScript" src="../../folder_javascript/tno_report_table_function.js?v=#versionParam#"></script>
		<!--- 20250815 [end  ] tno_report_table_function --->
		
		<!--- 20250826 [start] AI Chart --->
		<cfif cookie.cookuserloginid is 'm8'>
			<script>
				window.addEventListener('load', () => {
					(() => {
						const btn = document.getElementById('openAiTableBtn');
						const headerTableEl = document.getElementById('rpt_header_table_div');
						const rowHeaderEl   = document.getElementById('rowheader');
						const TARGET_ORIGIN = location.origin;
						
						if (!btn || !rowHeaderEl) {
							if (btn) btn.style.display = 'none';
							console.log("AI Chart Unable to work — missing button or rowHeader element. Please contact engineer to check.");
							return;
						}
						
						/* -------------------- Helpers -------------------- */
						function normalizeText(t) {
							return String(t || "")
							.replace(/\u00A0|&nbsp;/g, " ")
							.replace(/\r\n?/g, "\n")
							.replace(/[ \t]+\n/g, "\n")
							.trim();
						}
						
						// Generic banner cleaner: no hardcoded keywords.
						// Heuristics:
						//  - collapse internal spaces
						//  - drop empty lines
						//  - drop lines with NO letters/digits (pure symbols/whitespace)
						//  - collapse consecutive duplicates (case/space-insensitive)
						//  - keep the first up to MAX lines
						function buildCleanBanner(rawHeaderText, MAX = 8) {
							if (!rawHeaderText) return "";
							const lines = normalizeText(rawHeaderText)
							.split("\n")
							.map(s => s.replace(/\s+/g, " ").trim())
							.filter(Boolean)
							.filter(s => /[A-Za-z0-9]/.test(s)); // drop symbol-only lines
							
							const out = [];
							let prevKey = "";
							for (const s of lines) {
								const key = s.toLowerCase().replace(/\s+/g, " ");
								if (key !== prevKey) {
									out.push(s);
									prevKey = key;
								}
								if (out.length >= MAX) break;
							}
							return out.join("\n");
						}
						
						function resolveTable(el) {
							if (!el) return null;
							if (el.tagName && el.tagName.toUpperCase() === 'TABLE') return el;
							return el.querySelector ? el.querySelector('table') : null;
						}
						
						function collectTables() {
							const out = [];
							const headTable = resolveTable(rowHeaderEl);
							if (headTable) out.push(headTable);
							for (let i = 1; i <= 5000; i++) {
								const wrapper = document.getElementById('row' + i);
								if (!wrapper) break;
								const t = resolveTable(wrapper);
								if (t) out.push(t);
							}
							return out;
						}
						
						function sanitizeForCsv(text) {
							let t = String(text ?? '').replace(/\r?\n|\r/g, ' ').trim();
							t = t.replace(/"/g, '""');
							if (/^[=+\-@]/.test(t)) t = "'" + t; // CSV injection guard
							if (/[",\t]/.test(t)) t = `"${t}"`;
							return t;
						}
						
						function tableToCsv(table) {
							if (!table || !(table.rows && typeof table.rows.length === 'number')) {
								console.warn('Skipped non-table element:', table);
								return '';
							}
							const out = [];
							const grid = [];
							const rows = table.rows;
							for (let r = 0; r < rows.length; r++) {
								const row = rows[r];
								let cIndex = 0;
								grid[r] = grid[r] || [];
								const line = [];
								for (let c = 0; c < row.cells.length; c++) {
									while (grid[r][cIndex]) cIndex++;
									const cell = row.cells[c];
									const rs = cell.rowSpan || 1;
									const cs = cell.colSpan || 1;
									const val = sanitizeForCsv(cell.innerText);
									line[cIndex] = val;
									for (let rr = 0; rr < rs; rr++) {
										grid[r + rr] = grid[r + rr] || [];
										for (let cc = 0; cc < cs; cc++) {
											grid[r + rr][cIndex + cc] =
											grid[r + rr][cIndex + cc] || (rr === 0 && cc === 0 ? 'VAL' : 'SPAN');
										}
									}
									cIndex += cs;
								}
								const maxLen = grid[r].length;
								for (let i = 0; i < maxLen; i++) if (line[i] === undefined) line[i] = '';
								out.push(line.join(','));
							}
							return out.join('\r\n');
						}
						
						function buildCsvForRawTextarea() {
							const tables = collectTables();
							if (!tables.length) return "";
							const banner = buildCleanBanner(headerTableEl ? headerTableEl.innerText : "");
							const csvBody = tables.map(tableToCsv).filter(Boolean).join('\r\n');
							return (banner ? banner + "\r\n\r\n" : "") + csvBody; // no BOM here
						}
						
						function extractHeaderFromRaw(raw) {
							const s = String(raw || "").replace(/^\uFEFF/, "");
							const parts = s.split(/\r?\n\r?\n/);
							return (parts.length ? parts[0].trim() : "").trim();
						}
						
						/* -------------------- Auto enable & fill raw textarea -------------------- */
						try {
							const testTables = collectTables();
							if (!testTables.length) {
								btn.style.display = 'none';
								console.log("AI Chart Unable to work — no tables found to export. Please contact engineer to check.");
								return;
							}
						} catch (err) {
							btn.style.display = 'none';
							console.error("AI Chart Unable to work — error during table collection:", err);
							return;
						}
						
						// Fill all .csv_raw_table with CLEAN banner + CSV (no BOM)
						try {
							const csvRaw = buildCsvForRawTextarea();
							document.querySelectorAll('textarea.csv_raw_table').forEach(t => { t.value = csvRaw; });
						} catch (e) {
							console.error('Failed to build initial CSV for .csv_raw_table:', e);
						}
						
						/* -------------------- Button: prefer converted, else raw; rebuild if both empty -------------------- */
						btn.addEventListener('click', () => {
							const rawTa       = document.querySelector('textarea.csv_raw_table');
							const convertedTa = document.querySelector('textarea.csv_converted_long_format');
							
							let rawCsv       = rawTa ? String(rawTa.value || "") : "";
							let convertedCsv = convertedTa ? String(convertedTa.value || "") : "";
							
							// If both empty → try to rebuild from tables, also populate .csv_raw_table for visibility
							if (!convertedCsv.trim() && !rawCsv.trim()) {
								const rebuilt = buildCsvForRawTextarea();
								if (rebuilt.trim()) {
									rawCsv = rebuilt;
									if (rawTa) rawTa.value = rebuilt;
								}
							}
							
							const csvToSend = (convertedCsv.trim() ? convertedCsv : rawCsv).trim();
							if (!csvToSend) {
								alert('No CSV content to export. Please confirm the report tables are visible on this page.');
								console.warn('AI Chart abort: both csv_converted_long_format and csv_raw_table are empty, and rebuild failed.');
								return;
							}
							
							// Header always from RAW banner (even if sending converted)
							const headerFromRaw = extractHeaderFromRaw(rawCsv) ||
							(headerTableEl ? headerTableEl.innerText.trim() : "");
							const BOM = '\uFEFF';
							const payload = BOM + csvToSend;
							
							const reportTab = window.open('fr_ai_chart.cfm', '_blank');
							if (!reportTab) { alert('Please allow pop-ups for this site.'); return; }
							
							let messageSent = false;
							const onMessage = (e) => {
								if (e.origin !== TARGET_ORIGIN) return;
								if (e.source !== reportTab) return;
								if (e.data && e.data.type === 'ready' && !messageSent) {
									messageSent = true;
									window.removeEventListener('message', onMessage);
									reportTab.postMessage(
									{ type: 'table_csv', csv: payload, header: headerFromRaw },
									TARGET_ORIGIN
									);
								}
							};
							window.addEventListener('message', onMessage);
							
							// Fallback send if 'ready' not received in time
							setTimeout(() => {
								if (!messageSent) {
									try {
										messageSent = true;
										reportTab.postMessage(
										{ type: 'table_csv', csv: payload, header: headerFromRaw },
										TARGET_ORIGIN
										);
									} catch {}
								}
							}, 2500);
						});
					})();
				});
			</script>
		</cfif>
		<!--- 20250826 [end  ] AI Chart --->

		<cfset inc_report_main_heading_rendered_yn = "y">
		<script language="JavaScript" src="../../folder_javascript/jscript_topmain.js"></script>
		<cfif fromreport NEQ "fr_prj_progress_curve_rpt" and fromreport neq 'fr_proj_cshflow_projection_by_bu' and fromreport neq 'fr_proj_cshflow_projection_summ'>
			<script language="JavaScript" src="../../folder_jquery/jquery.min.js"></script>
		</cfif>
		<script language='javascript'>
		<!--
			$('prn_div').ready(function(){
				var tempDiv = document.getElementById('prn_div');
				tempDiv.className="div_listmain_head";

				var vTable = document.createElement("table");
				vTable.setAttribute("width","100%");
				var tbo=document.createElement('tbody');

				var vTr = document.createElement("tr");
				vTr.setAttribute("height","21");
				vTr.setAttribute("id","tr_tbl_backCover");
				var vTd = document.createElement("td");
				vTd.innerHTML = "&nbsp;";
				vTr.appendChild(vTd);
				tbo.appendChild(vTr);
				vTable.appendChild(tbo);
				tempDiv.parentNode.insertBefore(vTable,tempDiv.nextSibling);

				if (typeof document.all.prn_div == "object" && typeof document.getElementById('tr_tbl_backCover') == "object")
				{
					//document.getElementById("tr_tbl_backCover").style.display = "none";
				}
			});
		-->
		</script>
	</cfif>
	<cfinclude template="inc_form_trans_notepad.cfm">
</cfoutput>
<!--- original file
<cfoutput>
<cfparam name="setexcelborder" default="0">
</cfoutput>
---->

