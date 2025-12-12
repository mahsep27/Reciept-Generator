export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use POST.' 
    });
  }

  console.log('==========================================');
  console.log('📨 RECEIVED REQUEST FROM AIRTABLE');
  console.log('==========================================');
  
  try {
    const GOOGLE_APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL;
    const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
    const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Invoices';

    if (!GOOGLE_APPS_SCRIPT_URL) {
      throw new Error('GOOGLE_APPS_SCRIPT_URL environment variable is not set');
    }
    if (!AIRTABLE_API_KEY) {
      throw new Error('AIRTABLE_API_KEY environment variable is not set');
    }
    if (!AIRTABLE_BASE_ID) {
      throw new Error('AIRTABLE_BASE_ID environment variable is not set');
    }

    const requestData = req.body;
    const action = requestData.action || 'generate';

    console.log('🎬 Action:', action);

    // ========================================
    // HANDLE DELETE ACTION
    // ========================================
    if (action === 'delete') {
      console.log('🗑️ DELETE ACTION REQUESTED');
      
      const fileId = requestData.fileId;
      
      if (!fileId) {
        throw new Error('fileId is required for delete action');
      }

      console.log('   File ID:', fileId);
      console.log('📤 Forwarding delete request to Apps Script...');

      const appsScriptResponse = await fetch(GOOGLE_APPS_SCRIPT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'delete',
          fileId: fileId
        })
      });

      if (!appsScriptResponse.ok) {
        const errorText = await appsScriptResponse.text();
        throw new Error(`Apps Script delete request failed: ${appsScriptResponse.status} - ${errorText}`);
      }

      const deleteResult = await appsScriptResponse.json();

      console.log('📋 Delete Result:', JSON.stringify(deleteResult, null, 2));

      if (deleteResult.success) {
        console.log('✅ FILE DELETED SUCCESSFULLY FROM DRIVE');
        console.log('==========================================');
        
        return res.status(200).json({
          success: true,
          message: 'File deleted from Google Drive successfully',
          fileName: deleteResult.fileName,
          fileId: fileId
        });
      } else {
        throw new Error(`Delete failed: ${deleteResult.error || 'Unknown error'}`);
      }
    }

    // ========================================
    // HANDLE GENERATE ACTION (DEFAULT)
    // ========================================
    console.log('📄 GENERATE ACTION REQUESTED');
    
    const recordId = requestData.recordId;
    const tableName = requestData.tableName || AIRTABLE_TABLE_NAME;

    console.log('📦 Invoice Data:', JSON.stringify(requestData, null, 2));
    console.log('📋 Table Name:', tableName);

    if (!recordId) {
      throw new Error('recordId is required in the request body');
    }

    console.log('📤 STEP 1: Forwarding to Google Apps Script...');
    console.log('   URL:', GOOGLE_APPS_SCRIPT_URL);
    
    const appsScriptPayload = {
      ...requestData,
      action: 'generate'
    };

    const appsScriptResponse = await fetch(GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(appsScriptPayload)
    });

    if (!appsScriptResponse.ok) {
      const errorText = await appsScriptResponse.text();
      throw new Error(`Apps Script request failed: ${appsScriptResponse.status} - ${errorText}`);
    }

    const appsScriptResult = await appsScriptResponse.json();

    console.log('📋 Apps Script Response:', JSON.stringify(appsScriptResult, null, 2));

    if (!appsScriptResult.success) {
      throw new Error(`Apps Script Error: ${appsScriptResult.error || 'Unknown error from Apps Script'}`);
    }

    if (!appsScriptResult.fileName) {
      throw new Error('Apps Script did not return fileName');
    }

    if (!appsScriptResult.fileUrl || !appsScriptResult.fileId) {
      throw new Error('Apps Script did not return fileUrl and fileId. Make sure you updated the Apps Script code.');
    }

    console.log('✅ PDF Generated Successfully (Drive Link)');
    console.log('   File Name:', appsScriptResult.fileName);
    console.log('   File ID:', appsScriptResult.fileId);
    console.log('   File URL:', appsScriptResult.fileUrl);

    // STEP 2: Upload PDF to Airtable (WITHOUT Drive File ID)
    console.log('📤 STEP 2: Uploading PDF to Airtable...');
    console.log('   Base ID:', AIRTABLE_BASE_ID);
    console.log('   Table:', tableName);
    console.log('   Record ID:', recordId);

    const airtableUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}/${recordId}`;
    
    // ✅ ONLY upload the PDF, NOT the Drive File ID
    const updateFields = {
      'Invoice PDF': [{
        url: appsScriptResult.fileUrl,
        filename: appsScriptResult.fileName
      }]
    };

    const airtableUploadResponse = await fetch(airtableUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: updateFields
      })
    });

    if (!airtableUploadResponse.ok) {
      const errorText = await airtableUploadResponse.text();
      console.error('❌ Airtable Error Response:', errorText);
      throw new Error(`Airtable upload failed: ${airtableUploadResponse.status} - ${errorText}`);
    }

    const airtableResult = await airtableUploadResponse.json();
    
    console.log('✅ PDF UPLOADED TO AIRTABLE SUCCESSFULLY!');
    console.log('==========================================');

    return res.status(200).json({
      success: true,
      message: 'Invoice generated and uploaded to Airtable successfully',
      fileName: appsScriptResult.fileName,
      recordId: recordId,
      airtableRecordId: airtableResult.id,
      fileId: appsScriptResult.fileId, // Return fileId for deletion
      fileUrl: appsScriptResult.fileUrl
    });

  } catch (error) {
    console.error('==========================================');
    console.error('❌ ERROR:', error.message);
    console.error('Stack:', error.stack);
    console.error('==========================================');
    
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
